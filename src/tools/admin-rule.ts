/**
 * 행정규칙 관련 Tools
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse, MAX_RESPONSE_SIZE, formatDateDot } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { detectAbolishedAdminRule } from "../lib/abolished-laws.js"
import { analyzeImageOnlyBody, buildImageOnlyWarning } from "../lib/image-only-body.js"
import {
  adminRuleXmlCache, adminRuleCacheKey, ADMIN_RULE_CACHE_TTL_MS,
  buildPartialBody, pickPartialMode, PARTIAL_HINT,
} from "../lib/admin-rule-views.js"

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
// 법제처 admrul 상세는 법령과 달리 JO 파라미터가 없어 전문이 통짜로만 온다(실측).
// 부분 조회는 서버가 전문을 파싱해 제공하며, 우선순위는 jo > chapter > keyword > page.
export const GetAdminRuleSchema = z.object({
  id: z.string().describe("행정규칙일련번호 13자리 (search_admin_rule 결과의 '행정규칙일련번호'. 4~5자리 '행정규칙ID'는 조회되지 않음)"),
  jo: z.string().optional().describe("조문 지정 — '제9-5조', '9-5', '제10조의2', '9-5-2' 형식 모두 수용. 지정 조문만 반환"),
  context: z.number().optional().describe("jo와 함께 사용 — 전후 n개 조문을 함께 반환 (기본 0, 최대 10)"),
  chapter: z.string().optional().describe("장 지정 — '제9장' 또는 '9'. 해당 장 전체 반환"),
  keyword: z.string().optional().describe("본문 키워드 — 키워드가 포함된 조문 블록 목록 반환"),
  max_results: z.number().optional().describe("keyword와 함께 사용 — 최대 조문 수 (기본 10, 최대 30)"),
  page: z.number().optional().describe("전문을 청크로 페이징 조회 (1부터). 응답에 page/total_pages 표기"),
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
    // 전문 응답 캐시 — jo → keyword → page 연속 조회 시 Open API 재호출 방지
    const cacheKey = adminRuleCacheKey(input.id)
    let xmlText = adminRuleXmlCache.get<string>(cacheKey)
    const fromCache = xmlText !== null
    if (!xmlText) {
      xmlText = await apiClient.getAdminRule(input.id, input.apiKey)
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    // 행정규칙 정보 추출
    const ruleNameRaw = doc.getElementsByTagName("행정규칙명")[0]?.textContent?.trim() || ""
    const ruleName = ruleNameRaw || "알 수 없음"
    // 상세 응답의 실제 태그는 발령일자/발령번호 (공포일자는 없는 경우가 많다 — 실측)
    const promDate = doc.getElementsByTagName("공포일자")[0]?.textContent
      || doc.getElementsByTagName("발령일자")[0]?.textContent || ""
    const promNo = doc.getElementsByTagName("발령번호")[0]?.textContent || ""
    const orgName = doc.getElementsByTagName("소관부처")[0]?.textContent
      || doc.getElementsByTagName("소관부처명")[0]?.textContent || ""
    const ruleType = doc.getElementsByTagName("행정규칙종류")[0]?.textContent || ""
    const joForm = doc.getElementsByTagName("조문형식여부")[0]?.textContent?.trim() || ""

    if (ruleNameRaw && !fromCache) {
      adminRuleXmlCache.set(cacheKey, xmlText, ADMIN_RULE_CACHE_TTL_MS)
    }

    let resultText = `행정규칙명: ${ruleName}\n`
    if (promDate) resultText += `공포일: ${formatDateDot(promDate)}${promNo ? ` (제${promNo}호)` : ""}\n`
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

    // 조문 본문 (부칙·별표 제외 — 부분 조회의 파싱 대상).
    // 종전 출력과 동일하게 조문내용 태그 사이는 빈 줄로 구분한다.
    const articleParts: string[] = []
    for (let i = 0; i < joContents.length; i++) {
      const joContent = joContents[i].textContent?.trim() || ""
      if (joContent.length > 0) articleParts.push(joContent)
    }
    const articlesText = articleParts.join("\n\n")

    // 부칙
    let extrasText = ""
    const addendums = doc.getElementsByTagName("부칙내용")
    if (addendums.length > 0) {
      extrasText += `\n---\n부칙\n---\n\n`
      for (let i = 0; i < addendums.length; i++) {
        const content = addendums[i].textContent?.trim() || ""
        if (content.length > 0) {
          extrasText += `${content}\n\n`
        }
      }
    }

    // 별표
    const annexes = doc.getElementsByTagName("별표내용")
    if (annexes.length > 0) {
      extrasText += `\n---\n별표\n---\n\n`
      for (let i = 0; i < annexes.length; i++) {
        const title = doc.getElementsByTagName("별표제목")[i]?.textContent?.trim() || ""
        const content = annexes[i].textContent?.trim() || ""

        if (title) {
          extrasText += `[${title}]\n`
        }
        if (content.length > 0) {
          extrasText += `${content}\n\n`
        }
      }
    }

    const fullBody = `${articlesText}\n\n${extrasText}`.trim() + "\n"

    // 부분 조회 (jo > chapter > keyword > page) — 기존 전문 조회 동작은 그대로 유지
    const { mode } = pickPartialMode(input)
    if (mode) {
      const view = buildPartialBody(articlesText, fullBody, input)
      let out = resultText + `[${view.label}]\n`
      if (view.note) out += `${view.note}\n`
      out += `\n${view.text}`
      return {
        content: [{ type: "text", text: truncateResponse(out) }],
        ...(view.text.startsWith("[NOT_FOUND]") ? { isError: true as const } : {})
      }
    }

    resultText += fullBody

    // 전문이 응답 한도를 넘으면 잘림이 확실하므로, 잘려도 살아남도록
    // 부분 조회 힌트를 본문 "앞"에 둔다 (T3)
    if (resultText.length > MAX_RESPONSE_SIZE) {
      resultText = resultText.replace(/\n---\n\n/u, `\n---\nℹ️ 전문이 ${resultText.length.toLocaleString()}자입니다 — ${PARTIAL_HINT}\n---\n\n`)
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

/**
 * 신구대조 미제공 시 admrul 상세의 제·개정이유 폴백 (T2).
 * 발령번호·발령일자와 함께 반환하며, 이유 필드가 없으면 null.
 */
async function fetchRevisionFallback(
  apiClient: LawApiClient,
  id: string,
  apiKey?: string
): Promise<string | null> {
  try {
    const cacheKey = adminRuleCacheKey(id)
    let xmlText = adminRuleXmlCache.get<string>(cacheKey)
    if (!xmlText) {
      xmlText = await apiClient.getAdminRule(id, apiKey)
    }
    const doc = new DOMParser().parseFromString(xmlText, "text/xml")
    const reason = collectText(doc, "제개정이유내용").trim()
    if (!reason) return null
    const name = doc.getElementsByTagName("행정규칙명")[0]?.textContent?.trim() || ""
    const date = doc.getElementsByTagName("발령일자")[0]?.textContent?.trim() || ""
    const no = doc.getElementsByTagName("발령번호")[0]?.textContent?.trim() || ""
    const kind = doc.getElementsByTagName("제개정구분명")[0]?.textContent?.trim() || ""
    let head = ""
    if (name) head += `행정규칙명: ${name}\n`
    if (no || date) head += `발령: 제${no || "?"}호${date ? ` (${formatDateDot(date)})` : ""}${kind ? ` · ${kind}` : ""}\n`
    return `${head}\n${reason}`
  } catch {
    return null
  }
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
        // 행정규칙 신구대조는 law.go.kr 웹 화면에서 생성되는 뷰라 API 데이터가 없는
        // 경우가 많다. 이때 admrul 상세의 제·개정이유(개정이유·주요내용)를 폴백으로
        // 반환한다 — "제○조를 ○○로 한다" 수준은 아니어도 변경 취지·대상 조문이
        // 문장으로 들어 있어 실용적 대체재가 된다. (id가 행정규칙일련번호인 경우 동작)
        const fallback = await fetchRevisionFallback(apiClient, String(input.id), input.apiKey)
        if (fallback) {
          // 대조 헤더("알 수 없음" 등)는 버리고 폴백 자체 헤더로 대체한다
          const text = "[신구법 대조 데이터 없음 — 제·개정이유로 대체합니다]\n\n" + fallback
          return { content: [{ type: "text", text: truncateResponse(text) }] }
        }
        resultText += "[NOT_FOUND] 신구법 대조 데이터가 없습니다 (제·개정이유도 API 미제공).\n" +
          "law.go.kr 행정규칙 화면의 '제정·개정이유' 탭에서 확인할 수 있습니다.\n⚠️ LLM은 대조 내용을 추측하지 마세요."
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
