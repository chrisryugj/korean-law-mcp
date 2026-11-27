/**
 * 법령체계도(lsStmd JSON)의 자치법규: 법률·시행령·시행규칙 단계마다 매달린 조례·규칙.
 * 한 법률에 수백~천 건이라(주차장법 1,072건) 단계별 건수와 제목별 건수(지자체 이름을 뗀 제목)만 싣고,
 * region 을 주면 그 지자체 자치법규를 일련번호와 함께 싣는다(법제처 law-mcp get_law_hierarchy 대조, 2026-11-28).
 */
export interface TreeOrdinance {
  level: string
  kind: string
  name: string
  seq: string
  effDate: string
}

const LEVELS = new Set(["법률", "시행령", "시행규칙"])

/** 상하위법 트리를 돌며 "자치법규" 아래 조례·규칙 기본정보를 모은다. level 은 그 자치법규가 매달린 법령 단계 */
export function collectTreeOrdinances(hierarchy: unknown): TreeOrdinance[] {
  const out: TreeOrdinance[] = []
  const walk = (node: unknown, level: string) => {
    if (Array.isArray(node)) { node.forEach(n => walk(n, level)); return }
    if (!node || typeof node !== "object") return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "자치법규" && value && typeof value === "object") {
        for (const [kind, items] of Object.entries(value as Record<string, unknown>)) {
          for (const item of Array.isArray(items) ? items : [items]) {
            const info = (item as { 기본정보?: Record<string, unknown> })?.기본정보
            if (!info?.자치법규명) continue
            out.push({ level, kind, name: String(info.자치법규명), seq: String(info.자치법규일련번호 ?? ""), effDate: String(info.시행일자 ?? "") })
          }
        }
      } else if (LEVELS.has(key)) walk(value, key)
      else if (key !== "기본정보") walk(value, level)
    }
  }
  walk(hierarchy, "법률")
  return out
}

/** 제목 맨 앞 지자체 이름: "서울특별시 광진구 주차장…" → "서울특별시 광진구", "거제시 주차장 조례" → "거제시" */
export function jurisdictionOf(name: string): string {
  const t = name.trim().split(/\s+/)
  if (t.length > 1 && /(특별시|광역시|특별자치시|도|특별자치도)$/.test(t[0]) && /(시|군|구)$/.test(t[1])) return `${t[0]} ${t[1]}`
  return t[0] ?? ""
}

/** region("광진구"·"서울특별시 광진구"·"서울특별시")이 제목 맨 앞 지자체와 같은가. "서울특별시"는 서울시 자체 자치법규만(자치구 제외) */
export function matchesRegion(name: string, region: string): boolean {
  const j = jurisdictionOf(name)
  const r = region.trim().replace(/\s+/g, " ")
  return !!r && (j === r || j.endsWith(` ${r}`))
}

const fmt = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d)

export function renderTreeOrdinances(list: TreeOrdinance[], region?: string): string {
  if (!list.length) return ""
  const lines: string[] = [`자치법규 (체계도에 연결된 조례·규칙 ${list.length}건):`]
  for (const level of LEVELS) {
    const at = list.filter(o => o.level === level)
    if (!at.length) continue
    const byTitle = new Map<string, number>()
    for (const o of at) {
      const title = o.name.slice(jurisdictionOf(o.name).length).trim() || o.name
      byTitle.set(title, (byTitle.get(title) ?? 0) + 1)
    }
    const top = [...byTitle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    lines.push(`  ${level} 단계 ${at.length}건. 제목별: ${top.map(([t, n]) => `${t} ${n}`).join(", ")}${byTitle.size > 8 ? ` 외 ${byTitle.size - 8}종` : ""}`)
  }
  if (region) {
    const seen = new Set<string>()
    const mine = list.filter(o => matchesRegion(o.name, region) && !seen.has(o.seq || o.name) && seen.add(o.seq || o.name))
    lines.push("", mine.length
      ? `${region} 자치법규 (${mine.length}건):`
      : `${region} 자치법규: 이 체계도에 연결된 것이 없습니다(제목 맨 앞 지자체 이름 기준). 다른 표기(예: '서울특별시 광진구')로 다시 보거나 자치법규 검색으로 확인하세요.`)
    for (const o of mine) lines.push(`  ├─ ${o.name} [${o.kind}, ${o.level} 단계, 자치법규일련번호 ${o.seq}${o.effDate ? `, 시행 ${fmt(o.effDate)}` : ""}]`)
  }
  return lines.join("\n") + "\n"
}
