/**
 * get_annexes 의 date 갈래 (v4.15.0) — 기준일에 시행 중이던 법령 버전의 별표·서식
 *
 * 실무 기준이 별표에 있는 분야가 많다(소방시설 설치대상은 소방시설법 시행령 별표). 건축허가·착공·위반 시점 기준을
 * 물으면 현행 별표는 오답이다 — 번호도 바뀐다(2015년 시행령 별표5 "…갖추어야 하는 소방시설의 종류" → 현행 별표4).
 * 버전은 법령ID 계보(lib/law-lineage)로 특정하고, 별표는 그 버전의 시행 슬라이스 본문(eflaw MST+efYd)에서 집는다.
 * 분리시행이면 같은 MST 라도 슬라이스마다 별표 파일이 다르다(실측 MST 166678: 2015.1.8.판·4.7.판 별표5 파일 상이).
 */
import type { LawApiClient } from "../lib/api-client.js"
import { fetchLawAnnexUnits, type LawAnnexUnit } from "../lib/annex-canonical.js"
import { fetchLawVersions, lawStateAt, sameLawName, todayKst, versionInForce } from "../lib/law-lineage.js"
import { notFoundResponse } from "../lib/errors.js"
import { formatDateDot, truncateResponse } from "../lib/schemas.js"
import { normalizeDate } from "./applicable-law.js"
import { filterByAnnexQuery, filterByArticle, type AnnexItem } from "./annex-select.js"
import type { GetAnnexesInput } from "./annex.js"

type Response = { content: Array<{ type: string, text: string }>, isError?: boolean }
/** annex.ts 의 본문 추출기 — 순환 import 를 피하려고 주입받는다 */
export type AnnexExtractor = (
  apiClient: LawApiClient, annexList: AnnexItem[], selector: string, lawName: string, lawType: string,
  input: GetAnnexesInput, loadUnits: (mst: string) => Promise<LawAnnexUnit[]>,
) => Promise<Response>

const prepend = (header: string, r: Response): Response => ({
  ...r,
  content: [{ type: "text", text: header + r.content.map(c => c.text).join("\n") }],
})

export async function getAnnexesAtDate(
  apiClient: LawApiClient,
  input: GetAnnexesInput,
  lawName: string,
  selector: string,
  extract: AnnexExtractor,
): Promise<Response> {
  const ymd = normalizeDate(input.date || "")
  if (!ymd) {
    return notFoundResponse(`기준일 '${input.date}'을(를) 해석하지 못했습니다.`, ["지원 형식: 2015-06-01 / 2015.6.1 / 20150601 / 2015년 6월 1일"])
  }
  const { versions } = await fetchLawVersions(apiClient, lawName, input.apiKey)
  if (versions.length === 0) {
    return notFoundResponse(`'${lawName}'의 연혁을 찾지 못했습니다. 기준일(date) 별표 조회는 법령(법률·대통령령·부령)만 지원합니다.`, [
      "search_law로 정식 법령명을 확인하세요.",
      "자치법규·행정규칙 별표는 date 없이 현행을 조회하세요.",
    ])
  }
  const current = versionInForce(versions, todayKst())
  const { version: v, repeal } = lawStateAt(versions, ymd)
  if (repeal) {
    return notFoundResponse(`기준일 ${formatDateDot(ymd)} 당시 '${lawName}'은(는) 이미 폐지됐습니다 (시행 ${formatDateDot(repeal.efYd)}, 제${repeal.ancNo}호 ${repeal.rrCls}).`, [
      "당시 규율하던 후속 법령을 search_law로 확인하세요.",
    ])
  }
  if (!v) {
    const first = versions[versions.length - 1]
    return notFoundResponse(`기준일 ${formatDateDot(ymd)} 당시 '${lawName}'은(는) 시행 전입니다 (최초 시행 ${formatDateDot(first.efYd)}${first.lawNm ? `, 「${first.lawNm}」` : ""}).`, [
      "당시 규율하던 구법(폐지 법령)이 있는지 search_law로 확인하세요.",
    ])
  }

  const thenName = v.lawNm || lawName
  let header = `📅 기준일 ${formatDateDot(ymd)} 당시 시행 버전의 별표입니다.\n`
  header += `  「${thenName}」 [시행 ${formatDateDot(v.efYd)}] [제${v.ancNo}호, ${formatDateDot(v.ancYd)} ${v.rrCls}] (MST ${v.mst})\n`
  if (current && current.mst === v.mst && current.efYd === v.efYd) {
    header += "  ↳ 이 버전이 현행입니다.\n"
  } else if (current) {
    const renamed = current.lawNm && !sameLawName(current.lawNm, thenName) ? `현행 명칭 「${current.lawNm}」 · ` : ""
    header += `  ↳ ${renamed}현행(시행 ${formatDateDot(current.efYd)})과 별표 번호·내용이 다를 수 있습니다. 현행 별표와 맞춰 볼 때는 번호가 아니라 제목으로 대응시키세요.\n`
  }
  header += "\n"

  const units = await fetchLawAnnexUnits(apiClient, v.mst, input.apiKey, v.efYd)
  if (units.length === 0) {
    return notFoundResponse(`「${thenName}」 시행 ${formatDateDot(v.efYd)} 버전 본문에 별표·서식이 없습니다.`, [
      "모법·하위법령에 별표가 있을 수 있습니다 (시행령 ↔ 시행규칙).",
    ])
  }
  const items: AnnexItem[] = units.map(u => ({
    별표번호: u.code6, 별표명: u.title, 별표종류: u.kind,
    별표서식파일링크: u.hwpLink, 별표서식PDF파일링크: u.pdfLink,
    관련법령명: thenName, 관련법령일련번호: v.mst,
  }))
  const loadUnits = async () => units

  if (selector) return prepend(header, await extract(apiClient, items, selector, thenName, "law", input, loadUnits))

  const byArticle = filterByArticle(items, input.jo)
  const scoped = filterByAnnexQuery(byArticle.list, input.query)
  const only = scoped.list.length === 1 ? String(scoped.list[0].별표번호 || "") : ""
  if (only && ((scoped.matched && scoped.keywords.length > 0) || (byArticle.article && byArticle.matched))) {
    return prepend(header, await extract(apiClient, scoped.list, only, thenName, "law", input, loadUnits))
  }

  let text = header
  if (scoped.keywords.length > 0 && !scoped.matched) text += `⚠️ query="${scoped.keywords.join(" ")}"와 일치하는 별표명이 없어 전체 목록을 표시합니다.\n`
  if (byArticle.article && !byArticle.matched) text += `⚠️ ${byArticle.article}을(를) 근거로 밝힌 별표가 없어 전체 목록을 표시합니다.\n`
  text += `별표/서식 목록 (${scoped.list.length}건):\n\n`
  scoped.list.forEach((a, i) => {
    text += `${i + 1}. [${a.별표번호}] ${a.별표명}${a.별표종류 ? ` (${a.별표종류})` : ""}\n`
  })
  text += `\n본문: get_annexes({ lawName: "${lawName}", date: "${ymd}", bylSeq: "${scoped.list[0]?.별표번호 || "000100"}" })`
  return { content: [{ type: "text", text: truncateResponse(text) }] }
}
