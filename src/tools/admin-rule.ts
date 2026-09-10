/**
 * 행정규칙 관련 Tools
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { detectAbolishedAdminRule } from "../lib/abolished-laws.js"
import { analyzeImageOnlyBody, buildImageOnlyWarning } from "../lib/image-only-body.js"

// search_admin_rule 스키마
export const SearchAdminRuleSchema = z.object({
  query: z.string().describe("검색할 행정규칙명"),
  knd: z.string().optional().describe("행정규칙 종류 (1=훈령, 2=예규, 3=고시, 4=공고, 5=일반)"),
  display: z.number().optional().default(20).describe("최대 결과 개수"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SearchAdminRuleInput = z.infer<typeof SearchAdminRuleSchema>

export async function searchAdminRule(
  apiClient: LawApiClient,
  input: SearchAdminRuleInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.searchAdminRule({
      query: input.query,
      knd: input.knd,
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const rules = doc.getElementsByTagName("admrul")

    if (rules.length === 0) {
      // 폐지·제명변경된 행정규칙은 현행 검색에 안 잡힘 → 연혁(nw=2) 보조검색으로 안내
      const abolishedNote = await detectAbolishedAdminRule(apiClient, input.query, input.apiKey)
      if (abolishedNote) {
        return { content: [{ type: "text", text: truncateResponse(abolishedNote) }] }
      }
      return noResultHint(input.query || "", "행정규칙")
    }

    let resultText = `행정규칙 검색 결과 (총 ${rules.length}건):\n\n`

    const display = Math.min(rules.length, input.display)

    for (let i = 0; i < display; i++) {
      const rule = rules[i]

      const ruleName = rule.getElementsByTagName("행정규칙명")[0]?.textContent || "알 수 없음"
      const ruleSeq = rule.getElementsByTagName("행정규칙일련번호")[0]?.textContent || ""
      const ruleId = rule.getElementsByTagName("행정규칙ID")[0]?.textContent || ""
      const promDate = rule.getElementsByTagName("발령일자")[0]?.textContent || ""
      const ruleType = rule.getElementsByTagName("행정규칙종류")[0]?.textContent || ""
      const orgName = rule.getElementsByTagName("소관부처명")[0]?.textContent || ""

      resultText += `${i + 1}. ${ruleName}\n`
      resultText += `   - 행정규칙일련번호: ${ruleSeq} (get_admin_rule의 id)\n`
      resultText += `   - 행정규칙ID: ${ruleId} (참고용 — 전문 조회 불가)\n`
      resultText += `   - 공포일: ${promDate}\n`
      resultText += `   - 구분: ${ruleType}\n`
      resultText += `   - 소관부처: ${orgName}\n\n`
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "search_admin_rule")
  }
}

// get_admin_rule 스키마
export const GetAdminRuleSchema = z.object({
  id: z.string().describe("행정규칙일련번호 13자리 (search_admin_rule 결과의 '행정규칙일련번호'. 4~5자리 '행정규칙ID'는 조회되지 않음)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type GetAdminRuleInput = z.infer<typeof GetAdminRuleSchema>

/** xmldom 파싱 결과 타입 — 이 프로젝트는 DOM lib를 켜지 않는다 */
type XmlDoc = ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>

/** 태그별 텍스트를 순서대로 모은다 (xmldom NodeList는 iterable이 아니다) */
function collectText(doc: XmlDoc, tag: string): string {
  const nodes = doc.getElementsByTagName(tag)
  const out: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    const t = nodes[i].textContent?.trim() || ""
    if (t) out.push(t)
  }
  return out.join("\n")
}

/** 첨부파일명 ↔ 링크 짝 (#159 경고에서 원문 파일을 함께 안내하기 위한 것) */
function collectAttachments(doc: XmlDoc): Array<{ name: string; link: string }> {
  const links = doc.getElementsByTagName("첨부파일링크")
  const names = doc.getElementsByTagName("첨부파일명")
  const out: Array<{ name: string; link: string }> = []
  for (let i = 0; i < links.length; i++) {
    const link = links[i].textContent?.trim() || ""
    if (!link) continue
    out.push({ name: names[i]?.textContent?.trim() || `첨부 ${i + 1}`, link })
  }
  return out
}

/**
 * 전문이 비어 있을 때 원인별 안내 (#72)
 * 식별자 오류를 "법제처 API 제한"으로 뭉뚱그리면 원인 추적이 막힌다.
 */
function emptyBodyHint(id: string, ruleName: string, joForm: string): string {
  const noGuess = "⚠️ LLM은 행정규칙 내용을 추측/생성하지 마세요."

  if (!ruleName) {
    return `[NOT_FOUND] 행정규칙을 찾을 수 없습니다 (id=${id}).\n\n` +
      "id에는 search_admin_rule 결과의 '행정규칙일련번호'(13자리)를 넘겨야 합니다. " +
      "'행정규칙ID'(4~5자리)로는 조회되지 않습니다.\n" + noGuess
  }

  if (joForm === "N") {
    return `[NOT_FOUND] '${ruleName}'은(는) 조문 형식이 아닙니다 (조문형식여부=N).\n\n` +
      "본문이 첨부파일로만 제공되는 행정규칙입니다.\n" + noGuess
  }

  return `[NOT_FOUND] '${ruleName}'의 전문을 조회할 수 없습니다.\n\n` + noGuess
}

export async function getAdminRule(
  apiClient: LawApiClient,
  input: GetAdminRuleInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.getAdminRule(input.id, input.apiKey)

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    // 행정규칙 정보 추출
    const ruleNameRaw = doc.getElementsByTagName("행정규칙명")[0]?.textContent?.trim() || ""
    const ruleName = ruleNameRaw || "알 수 없음"
    const promDate = doc.getElementsByTagName("공포일자")[0]?.textContent || ""
    const orgName = doc.getElementsByTagName("소관부처")[0]?.textContent || ""
    const ruleType = doc.getElementsByTagName("행정규칙종류")[0]?.textContent || ""
    const joForm = doc.getElementsByTagName("조문형식여부")[0]?.textContent?.trim() || ""

    let resultText = `행정규칙명: ${ruleName}\n`
    if (promDate) resultText += `공포일: ${promDate}\n`
    if (ruleType) resultText += `종류: ${ruleType}\n`
    if (orgName) resultText += `소관부처: ${orgName}\n`
    resultText += `\n---\n\n`

    // 조문 추출 - <조문내용> 태그 사용
    const joContents = doc.getElementsByTagName("조문내용")

    if (joContents.length === 0) {
      // 첨부파일 확인
      const attachments = doc.getElementsByTagName("첨부파일링크")
      if (attachments.length > 0) {
        resultText += "[주의] 이 행정규칙은 조문 형식이 아닌 첨부파일로 제공됩니다.\n\n"
        resultText += "첨부파일:\n"
        for (let i = 0; i < attachments.length; i++) {
          const link = attachments[i].textContent || ""
          if (link) {
            resultText += `   ${i + 1}. ${link}\n`
          }
        }
        return {
          content: [{
            type: "text",
            text: truncateResponse(resultText)
          }]
        }
      }

      return {
        content: [{ type: "text", text: emptyBodyHint(input.id, ruleNameRaw, joForm) }],
        isError: true
      }
    }

    // 조문내용이 비어있는지 확인
    let hasContent = false
    for (let i = 0; i < joContents.length; i++) {
      const content = joContents[i].textContent?.trim() || ""
      if (content.length > 0) {
        hasContent = true
        break
      }
    }

    if (!hasContent) {
      // 첨부파일 확인
      const attachments = doc.getElementsByTagName("첨부파일링크")
      if (attachments.length > 0) {
        resultText += "[주의] 이 행정규칙은 조문 형식이 아닌 첨부파일로 제공됩니다.\n\n"
        resultText += "첨부파일:\n"
        for (let i = 0; i < attachments.length; i++) {
          const link = attachments[i].textContent || ""
          if (link) {
            resultText += `   ${i + 1}. ${link}\n`
          }
        }
      } else {
        resultText += "[주의] 이 행정규칙은 조문 내용이 비어있습니다."
      }
      return {
        content: [{
          type: "text",
          text: truncateResponse(resultText)
        }]
      }
    }

    // 이미지-only 경고 (#159) — 본문 앞에 둔다. 뒤에 붙이면 truncateResponse가
    // 경고부터 잘라내고 무의미한 <img> 태그만 남아 LLM이 수치를 지어내기 쉬워진다.
    const bodyText = `${collectText(doc, "조문내용")}\n${collectText(doc, "별표내용")}`
    const imgInfo = analyzeImageOnlyBody(bodyText)
    if (imgInfo.imageOnly) {
      resultText += buildImageOnlyWarning(input.id, imgInfo, collectAttachments(doc)) + "\n"
    }

    // 조문 내용 출력
    for (let i = 0; i < joContents.length; i++) {
      const joContent = joContents[i].textContent?.trim() || ""

      if (joContent.length > 0) {
        resultText += `${joContent}\n\n`
      }
    }

    // 부칙 추가
    const addendums = doc.getElementsByTagName("부칙내용")
    if (addendums.length > 0) {
      resultText += `\n---\n부칙\n---\n\n`
      for (let i = 0; i < addendums.length; i++) {
        const content = addendums[i].textContent?.trim() || ""
        if (content.length > 0) {
          resultText += `${content}\n\n`
        }
      }
    }

    // 별표 추가
    const annexes = doc.getElementsByTagName("별표내용")
    if (annexes.length > 0) {
      resultText += `\n---\n별표\n---\n\n`
      for (let i = 0; i < annexes.length; i++) {
        const title = doc.getElementsByTagName("별표제목")[i]?.textContent?.trim() || ""
        const content = annexes[i].textContent?.trim() || ""

        if (title) {
          resultText += `[${title}]\n`
        }
        if (content.length > 0) {
          resultText += `${content}\n\n`
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "get_admin_rule")
  }
}

// compare_admin_rule_old_new 스키마
export const CompareAdminRuleOldNewSchema = z.object({
  query: z.string().optional().describe("행정규칙명 키워드 (검색용)"),
  id: z.string().optional().describe("신구법일련번호 13자리 (본문 조회용, 이 도구의 검색 결과에서 획득)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.query || data.id, {
  message: "query(검색) 또는 id(본문조회) 중 하나는 필수입니다"
})

export type CompareAdminRuleOldNewInput = z.infer<typeof CompareAdminRuleOldNewSchema>

/**
 * 신구법 조문의 <P>…</P> 개정 표시를 【 】로 보존한 뒤 나머지 태그 제거.
 * 태그 제거는 영문 태그로 한정 — 본문에 <신  설>·<단서 신설> 같은 꺾쇠 표기가 그대로 온다.
 */
function markChangedParts(text: string): string {
  return text
    .replace(/<p>/gi, "【")
    .replace(/<\/p>/gi, "】")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .trim()
}

export async function compareAdminRuleOldNew(
  apiClient: LawApiClient,
  input: CompareAdminRuleOldNewInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    if (input.id) {
      // 본문 조회: lawService.do, target=admrulOldAndNew
      const xmlText = await apiClient.fetchApi({
        endpoint: "lawService.do",
        target: "admrulOldAndNew",
        type: "XML",
        extraParams: { ID: String(input.id) },
        apiKey: input.apiKey
      })

      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlText, "text/xml")

      // 응답 구조: <구조문_기본정보>/<신조문_기본정보> + <구조문목록>/<신조문목록> 안의 <조문 no="N">
      const oldInfo = doc.getElementsByTagName("구조문_기본정보")[0]
      const newInfo = doc.getElementsByTagName("신조문_기본정보")[0]
      const ruleName = (newInfo || oldInfo)?.getElementsByTagName("행정규칙명")[0]?.textContent?.trim() || "알 수 없음"
      const oldDate = oldInfo?.getElementsByTagName("시행일자")[0]?.textContent?.trim() || ""
      const newDate = newInfo?.getElementsByTagName("시행일자")[0]?.textContent?.trim() || ""

      let resultText = `행정규칙 신구법 대조: ${ruleName}\n`
      if (oldDate || newDate) resultText += `시행일: ${oldDate || "?"} → ${newDate || "?"}\n`
      resultText += `※ 【 】 = 개정된 부분\n`
      resultText += `---\n\n`

      const oldArticles = doc.getElementsByTagName("구조문목록")[0]?.getElementsByTagName("조문")
      const newArticles = doc.getElementsByTagName("신조문목록")[0]?.getElementsByTagName("조문")
      const maxCount = Math.max(oldArticles?.length || 0, newArticles?.length || 0)

      if (maxCount === 0) {
        resultText += "[NOT_FOUND] 신구법 대조 데이터가 없습니다.\n⚠️ LLM은 대조 내용을 추측하지 마세요."
        return { content: [{ type: "text", text: resultText }], isError: true }
      }

      const displayCount = Math.min(maxCount, 30)
      for (let i = 0; i < displayCount; i++) {
        const oldContent = markChangedParts(oldArticles?.[i]?.textContent || "")
        const newContent = markChangedParts(newArticles?.[i]?.textContent || "")

        resultText += `---\n`
        resultText += `[개정 전] ${oldContent || "(신설)"}\n\n`
        resultText += `[개정 후] ${newContent || "(삭제)"}\n\n`
      }

      if (maxCount > displayCount) {
        resultText += `\n... 외 ${maxCount - displayCount}개 항목 (생략)\n`
      }

      return { content: [{ type: "text", text: truncateResponse(resultText) }] }
    }

    // 검색: lawSearch.do, target=admrulOldAndNew
    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "admrulOldAndNew",
      type: "XML",
      extraParams: { query: String(input.query) },
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    // 신구법 검색 응답은 <oldAndNew> 항목에 신구법* 필드로 온다 (admrul 아님)
    const rules = doc.getElementsByTagName("oldAndNew")
    if (rules.length === 0) {
      return noResultHint(input.query || "", "행정규칙 신구법")
    }

    let resultText = `행정규칙 신구법 검색 결과 (총 ${rules.length}건):\n\n`

    const display = Math.min(rules.length, 20)
    for (let i = 0; i < display; i++) {
      const rule = rules[i]
      const name = rule.getElementsByTagName("신구법명")[0]?.textContent || "알 수 없음"
      const ruleSeq = rule.getElementsByTagName("신구법일련번호")[0]?.textContent || ""
      const promDate = rule.getElementsByTagName("발령일자")[0]?.textContent || ""
      const orgName = rule.getElementsByTagName("소관부처명")[0]?.textContent || ""

      resultText += `${i + 1}. ${name}\n`
      resultText += `   - 신구법일련번호: ${ruleSeq} (id 파라미터)\n`
      resultText += `   - 발령일: ${promDate}\n`
      resultText += `   - 소관부처: ${orgName}\n\n`
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return { content: [{ type: "text", text: truncateResponse(resultText) }] }
  } catch (error) {
    return formatToolError(error, "compare_admin_rule_old_new")
  }
}
