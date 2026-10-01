/**
 * 행정규칙 상세 XML → get_admin_rule·신구대조 폴백이 쓰는 값만 뽑은 문서. `admrulxml:` 캐시 값이다.
 *
 * 캐시 값이 XML 원문이면 적중해도 매번 DOM 을 새로 만들고 조문을 다시 파싱했다 — 보험업감독업무시행세칙
 * (XML 313만 자)은 캐시 적중 jo 한 번에 약 1초 이벤트 루프를 막았다(2026-10-01 감사). 부분 조회는 같은 규칙을
 * 여러 번 부르는 용도라 누적된다. 그래서 파싱은 받을 때 한 번, 조문 파싱은 첫 부분 조회 때 한 번만 한다.
 */
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "./api-client.js"
import { analyzeImageOnlyBody, markInlineImages, type ImageOnlyBody } from "./image-only-body.js"
import { parseAdminRuleArticles, type ParsedAdminRule } from "./admin-rule-articles.js"
import type { ExtraBlock } from "./admin-rule-keyword.js"
import { adminRuleXmlCache, adminRuleCacheKey, ADMIN_RULE_CACHE_TTL_MS } from "./admin-rule-views.js"

export interface AdminRuleDoc {
  /** 행정규칙명 원문 — 비면 식별자 오류(행정규칙ID 를 넘긴 경우 등) */
  ruleName: string
  promDate: string
  /** 발령일자 (신구대조 폴백 머리말) */
  issuedDate: string
  promNo: string
  orgName: string
  ruleType: string
  joForm: string
  efDate: string
  revision: string
  isCurrent: string
  /** <조문내용> 태그 수 */
  joTagCount: number
  /** 비어 있지 않은 <조문내용>이 있는가 */
  hasContent: boolean
  /** 비어 있지 않은 조문내용(이미지 표식 치환)을 빈 줄로 이은 것 — 부분 조회의 파싱 대상 */
  articlesText: string
  /** <부칙내용> 태그가 있으면 비어 있지 않은 내용들, 없으면 null */
  addenda: string[] | null
  /** <별표내용> 태그가 있으면 [제목, 내용(이미지 표식 치환)] 들, 없으면 null */
  annexes: Array<{ title: string, content: string }> | null
  /** 첨부파일링크 원문(빈 값 포함 — 출력 번호를 종전과 맞춘다) */
  attachmentLinks: string[]
  attachments: Array<{ name: string, link: string }>
  imgInfo: ImageOnlyBody
  /** 제·개정이유 (신구대조 폴백) */
  revisionReason: string
  /** 조문 파싱 결과 — 첫 부분 조회 때 채운다 */
  parsed?: ParsedAdminRule
}

type XmlDoc = ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>

const first = (doc: XmlDoc, tag: string) => doc.getElementsByTagName(tag)[0]?.textContent || ""
const all = (doc: XmlDoc, tag: string): string[] => {
  const nodes = doc.getElementsByTagName(tag)
  const out: string[] = []
  for (let i = 0; i < nodes.length; i++) out.push(nodes[i].textContent || "")
  return out
}

function parseAdminRuleXml(xmlText: string): AdminRuleDoc {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml")
  const joRaw = all(doc, "조문내용").map(t => t.trim())
  const annexRaw = all(doc, "별표내용").map(t => t.trim())
  const annexTitles = all(doc, "별표제목").map(t => t.trim())
  const addendaRaw = all(doc, "부칙내용").map(t => t.trim())
  const links = all(doc, "첨부파일링크")
  const names = all(doc, "첨부파일명")
  const articleParts = joRaw.filter(Boolean)
  // xmldom 이 주는 텍스트는 원문 XML 의 조각(sliced string)이라 그대로 캐시하면 XML 전체가 함께 남는다 —
  // 실측: 큰 규칙 5건에서 XML 만 둘 때보다 6.7MB 더 붙잡았다. 복제해 원문과 끊는다.
  return structuredClone({
    ruleName: first(doc, "행정규칙명").trim(),
    // 상세 응답의 실제 태그는 발령일자/발령번호 (공포일자는 없는 경우가 많다 — 실측)
    promDate: first(doc, "공포일자") || first(doc, "발령일자"),
    issuedDate: first(doc, "발령일자").trim(),
    promNo: first(doc, "발령번호"),
    orgName: first(doc, "소관부처") || first(doc, "소관부처명"),
    ruleType: first(doc, "행정규칙종류"),
    joForm: first(doc, "조문형식여부").trim(),
    efDate: first(doc, "시행일자").trim(),
    revision: first(doc, "제개정구분명").trim(),
    isCurrent: first(doc, "현행여부").trim(),
    joTagCount: joRaw.length,
    hasContent: articleParts.length > 0,
    articlesText: articleParts.map(markInlineImages).join("\n\n"),
    addenda: addendaRaw.length ? addendaRaw.filter(Boolean) : null,
    annexes: annexRaw.length ? annexRaw.map((c, i) => ({ title: annexTitles[i] || "", content: c ? markInlineImages(c) : "" })) : null,
    attachmentLinks: links,
    attachments: links.map((l, i) => ({ name: names[i]?.trim() || `첨부 ${i + 1}`, link: l.trim() })).filter(a => a.link),
    // 이미지-only 판정은 표식 치환 전 원문으로 (#159)
    imgInfo: analyzeImageOnlyBody(`${articleParts.join("\n")}\n${annexRaw.filter(Boolean).join("\n")}`),
    revisionReason: all(doc, "제개정이유내용").map(t => t.trim()).filter(Boolean).join("\n"),
  })
}

/** 부칙·별표 출력 (종전 전문 출력과 같은 모양) */
export function adminRuleExtrasText(d: AdminRuleDoc): string {
  let text = ""
  if (d.addenda) {
    text += `\n---\n부칙\n---\n\n`
    for (const c of d.addenda) text += `${c}\n\n`
  }
  if (d.annexes) {
    text += `\n---\n별표\n---\n\n`
    for (const a of d.annexes) {
      if (a.title) text += `[${a.title}]\n`
      if (a.content) text += `${a.content}\n\n`
    }
  }
  return text
}

/** keyword 가 조문에서 못 찾으면 이어 찾는 부칙·별표 블록 */
export function adminRuleExtraBlocks(d: AdminRuleDoc): ExtraBlock[] {
  const firstLine = (s: string) => s.split("\n", 1)[0].trim().slice(0, 60)
  const blocks: ExtraBlock[] = (d.addenda ?? []).map(c => ({ label: firstLine(c), text: c }))
  for (const a of d.annexes ?? []) {
    if (!a.content) continue
    blocks.push(a.title ? { label: `[${a.title}]`, text: `[${a.title}]\n${a.content}` } : { label: firstLine(a.content), text: a.content })
  }
  return blocks
}

/** 조문 파싱 결과 — 문서(캐시 값)에 한 번만 만들어 둔다 */
export function adminRuleParsed(d: AdminRuleDoc): ParsedAdminRule {
  d.parsed ??= parseAdminRuleArticles(d.articlesText)
  return d.parsed
}

/**
 * 캐시 → 없으면 조회·파싱 후 캐시. applicable_law 행정규칙 갈래는 예산 소진·취소를 공개 도구 밖에서 받으려고
 * XML 문자열을 먼저 넣어 둔다 — 그 값을 만나면 파싱해 문서로 바꿔 넣는다.
 */
export async function loadAdminRuleDoc(apiClient: LawApiClient, id: string, apiKey?: string): Promise<AdminRuleDoc> {
  const key = adminRuleCacheKey(id)
  const cached = adminRuleXmlCache.get<AdminRuleDoc | string>(key)
  if (cached && typeof cached !== "string") return cached
  const doc = parseAdminRuleXml(cached || await apiClient.getAdminRule(id, apiKey))
  if (doc.ruleName) adminRuleXmlCache.set(key, doc, ADMIN_RULE_CACHE_TTL_MS)
  return doc
}
