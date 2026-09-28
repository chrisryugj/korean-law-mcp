/**
 * applicable_law 의 행정규칙 갈래 (v4.15.0) — 고시·훈령·예규의 기준일 시행 버전 특정
 *
 * 소방시설 설치기준(화재안전기준)처럼 실무 기준이 고시에 있는 분야는 "건축허가 당시 기준"을 묻는 일이 많다.
 * 법령과 같은 출력 틀(기준일 버전 → 조문 → 현행 비교 → 연혁)로 답한다. 호출부는 법령 식별이 실패했을 때만 부른다.
 */
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse, formatDateDot } from "../lib/schemas.js"
import {
  adminVersionAt, fetchAdminRuleHistory, nfCode, pickAdminRuleGroup, type AdminRuleVersion,
} from "../lib/admin-rule-history.js"
import { getAdminRule } from "./admin-rule.js"
import { adminRuleXmlCache, adminRuleCacheKey, ADMIN_RULE_CACHE_TTL_MS } from "../lib/admin-rule-views.js"
import { sameLawName, todayKst } from "../lib/law-lineage.js"
import type { ToolResponse } from "../lib/types.js"

const fmt = formatDateDot
const label = (v: AdminRuleVersion) =>
  `${v.name} [시행 ${fmt(v.efYd || v.issuedYd)}] [${v.org ? `${v.org} ` : ""}${v.kind} 제${v.issuedNo}호, ${fmt(v.issuedYd)} 발령, ${v.rrCls}] (행정규칙일련번호 ${v.serial})`

/**
 * 한 버전의 조문 본문. XML 은 여기서 먼저 받아 get_admin_rule 캐시에 넣는다 — 공개 도구 안에서 받으면 예산 소진·취소가
 * isError 로 바뀌어 "당시 미신설"로 둔갑했다. 본문은 "[조문 조회: …]" 라벨 뒤만 취한다: 그 앞의 이미지 안내엔 일련번호별 URL 이
 * 있어 같은 조문도 늘 "변경됨"으로 비교됐고, 조문 체계 없는 규칙의 안내문이 조문으로 실렸다(2026-09-28 리뷰).
 */
async function articleBody(apiClient: LawApiClient, id: string, jo: string, apiKey?: string): Promise<string> {
  const key = adminRuleCacheKey(id)
  if (!adminRuleXmlCache.get<string>(key)) {
    const xml = await apiClient.getAdminRule(id, apiKey)
    if (xml.includes("<행정규칙명")) adminRuleXmlCache.set(key, xml, ADMIN_RULE_CACHE_TTL_MS)
  }
  const r = await getAdminRule(apiClient, { id, jo, apiKey })
  if (r.isError) return ""
  const text = r.content.map(c => c.text).join("\n")
  const label = text.indexOf("[조문 조회:")
  if (label < 0) return ""
  const body = text.slice(text.indexOf("\n", label) + 1).trim()
  return /^(\[NOT_FOUND\]|이 행정규칙은 조문 체계가 없습니다)/.test(body) ? "" : body
}

/**
 * 법령이 아닌 이름을 행정규칙 연혁으로 판단한다. 행정규칙도 못 찾으면 undefined — 호출부가 NOT_FOUND 를 낸다.
 * date 는 YYYYMMDD 로 정규화된 값.
 */
export async function applicableAdminRule(
  apiClient: LawApiClient,
  input: { lawName: string, date: string, jo?: string, apiKey?: string },
): Promise<ToolResponse | undefined> {
  const { groups, truncated } = await fetchAdminRuleHistory(apiClient, input.lawName, input.apiKey)
  if (groups.size === 0) return undefined
  const group = pickAdminRuleGroup(groups, input.lawName)
  if (!group) {
    const names = [...groups.values()].map(g => `  - ${g[0].name} (행정규칙ID ${g[0].ruleId}, 버전 ${g.length}개)`).slice(0, 10)
    return {
      content: [{
        type: "text",
        text: `[NOT_FOUND] '${input.lawName}'과(와) 이름이 맞는 법령·행정규칙을 정확히 찾지 못했습니다. 기준일 판단은 하지 않았습니다.\n` +
          `행정규칙 후보 — 해당하면 정식 명칭으로 다시 호출하세요:\n${names.join("\n")}\n` +
          `법령이라면 search_law로 정식 법령명을 확인하세요.`,
      }],
      isError: true,
    }
  }

  const date = input.date
  const today = todayKst()
  // 현행은 날짜로 정한다 — 현행연혁구분 플래그는 발령됐으나 시행 전인 본을 "현행"으로 달 수 있다
  const nowState = adminVersionAt(group, today)
  const current = nowState.version ?? nowState.abolished ?? group[group.length - 1]
  const { version, note, abolished } = adminVersionAt(group, date)
  const lines: string[] = [`═══ 기준일 시행 행정규칙: ${current.name} @ ${fmt(date)} ═══`, ""]
  if (truncated) lines.push("⚠️ 연혁 검색 결과가 많아 일부만 받았습니다 — 정식 명칭으로 다시 부르면 전 버전을 봅니다.", "")

  if (abolished) {
    lines.push(`✗ 기준일 ${fmt(date)} 당시 이 행정규칙은 이미 폐지됐습니다: ${label(abolished)}`)
    return { content: [{ type: "text", text: truncateResponse(lines.join("\n")) }] }
  }
  if (!version) {
    const first = group[group.length - 1]
    lines.push(`✗ 기준일 ${fmt(date)} 당시 이 행정규칙은 시행 전입니다. 최초: ${label(first)}`)
    return { content: [{ type: "text", text: truncateResponse(lines.join("\n")) }] }
  }

  lines.push("▶ 기준일에 시행 중이던 버전")
  lines.push(`  ${label(version)}`)
  if (!sameLawName(version.name, current.name)) {
    lines.push(`  ↳ 당시 명칭은 「${version.name}」 — 현행 「${current.name}」과 같은 규칙(행정규칙ID ${version.ruleId})입니다.`)
  }
  if (note) lines.push(`  ⚠️ ${note}`)
  const later = group.filter(v => (v.efYd || v.issuedYd) > (version.efYd || version.issuedYd) && (v.efYd || v.issuedYd) <= today)
  const whole = later.filter(v => /전부개정|폐지제정/.test(v.rrCls))
  if (nowState.abolished) {
    lines.push(`  ⚠️ 이 행정규칙은 폐지됐습니다: ${label(nowState.abolished)} — 현행이 없습니다.`)
  } else if (version.serial === current.serial) {
    lines.push("  ↳ 이 버전이 현행입니다 (기준일 이후 개정 없음)")
  } else {
    lines.push(`  ↳ 기준일 이후 현재까지 ${later.length}차례 개정·시행됨 (현행: ${label(current)})`)
    if (whole.length > 0) {
      const w = whole[whole.length - 1]
      lines.push(`  ⚠️ 그 사이 전부개정(시행 ${fmt(w.efYd)}, 제${w.issuedNo}호)으로 조문 체계가 바뀌었습니다 — 같은 조번호라도 현행에선 다른 조문일 수 있습니다.`)
    }
  }
  const upcoming = group.filter(v => (v.efYd || "") > today)
  if (upcoming.length > 0) {
    const next = upcoming[upcoming.length - 1]
    lines.push(`  ⚠️ 발령됐으나 시행 전인 개정: 제${next.issuedNo}호 (시행 ${fmt(next.efYd)}, 일련번호 ${next.serial})`)
  }
  // 2022.12.1. 화재안전기준 개편: 성능기준(NFPC, 소방청 고시)과 기술기준(NFTC, 국립소방연구원 공고)으로 나뉘어
  // 설치 위치·수치 같은 세부 기준은 NFTC 쪽에 있다. NFSC·NFPC 계보만 보면 그 부분을 놓친다.
  const code = nfCode(version.name)
  if (code?.family === "performance" && /NFPC/i.test(version.name)) {
    lines.push(`  ℹ️ 2022.12.1. 개편 뒤 세부 기술기준은 「화재안전기술기준(NFTC ${code.code})」(국립소방연구원 공고)에 있습니다 — 함께 확인: legal_analysis(mode="applicable_law", lawName="NFTC ${code.code}", date="${date}")`)
  }

  if (input.jo) {
    const [thenText, nowText] = await Promise.all([
      articleBody(apiClient, version.serial, input.jo, input.apiKey),
      version.serial !== current.serial && whole.length === 0 && !nowState.abolished
        ? articleBody(apiClient, current.serial, input.jo, input.apiKey)
        : Promise.resolve(""),
    ])
    lines.push("", `▶ 기준일 시점 조문: ${input.jo}`)
    lines.push(thenText
      ? (thenText.length > 3000 ? `${thenText.slice(0, 3000)}\n…(생략 — get_admin_rule(id="${version.serial}", jo="${input.jo}")로 전체)` : thenText)
      : `  [NOT_FOUND] 해당 버전에서 ${input.jo}를 찾지 못했습니다 (당시 미신설이거나 조문 체계가 다름). get_admin_rule(id="${version.serial}", keyword="…")로 본문을 검색하세요. LLM은 본문을 추측하지 마세요.`)
    if (thenText && nowText) {
      const norm = (s: string) => s.replace(/\s+/g, "")
      lines.push("", norm(thenText) === norm(nowText)
        ? "▶ 현행과 비교: ✅ 동일 (기준일 이후 이 조문은 바뀌지 않음)"
        : `▶ 현행과 비교: △ 변경됨 — 현행 본문과 다릅니다. 기준일 사안에는 위 기준일 버전을 쓰세요. 현행: get_admin_rule(id="${current.serial}", jo="${input.jo}")`)
    }
  } else {
    lines.push("", `▶ 본문: get_admin_rule(id="${version.serial}", jo="제N조" 또는 keyword="…")`)
  }

  lines.push("", `▶ 발령 연혁 (${group.length}개 버전, 최신순${group.length > 15 ? " — 상위 15개" : ""})`)
  for (const v of group.slice(0, 15)) {
    const mark = v === version ? " ◀ 기준일 버전" : v === nowState.abolished ? " [폐지]" : v === current ? " [현행]" : ""
    lines.push(`  시행 ${fmt(v.efYd || v.issuedYd)} | 제${v.issuedNo}호 ${v.rrCls} | ${v.serial}${!sameLawName(v.name, current.name) ? ` | ${v.name}` : ""}${mark}`)
  }

  lines.push("", "⚖️ 주의")
  lines.push("  - 행정규칙(고시 등)을 언제 기준으로 적용할지는 근거 법령과 부칙의 경과규정이 정합니다. 이 결과는 기준일에 시행 중이던 버전을 특정할 뿐입니다.")
  if (code) {
    lines.push("  - 화재안전기준이 강화돼도 기존 특정소방대상물에는 원칙적으로 변경 전 기준을 적용합니다(「소방시설 설치 및 관리에 관한 법률」 제13조제1항, 예외 설비 있음). 증축·용도변경은 그 당시 기준(같은 조 제3항).")
  }
  return { content: [{ type: "text", text: truncateResponse(lines.join("\n")) }] }
}
