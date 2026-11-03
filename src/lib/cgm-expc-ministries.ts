/**
 * 중앙부처 1차 해석 부처 목록 — 법제처 OPEN API target `<코드>CgmExpc` 의 코드 → 부처명 (#182)
 *
 * open.law.go.kr 활용가이드 "중앙부처 1차 해석" 39개 부처(2026-11-03 실측, 전부 목록 응답 확인).
 * 부처명은 가이드 표기(현 직제)를 따른다. 본문은 nts·moef 만 법제처 lawService 가 없고 taxlaw 링크로 온다.
 */
export const CGM_EXPC_MINISTRIES: Readonly<Record<string, string>> = {
  moel: "고용노동부", molit: "국토교통부", moef: "재정경제부", mof: "해양수산부",
  mois: "행정안전부", me: "기후에너지환경부", kcs: "관세청", nts: "국세청",
  moe: "교육부", msit: "과학기술정보통신부", mpva: "국가보훈부", mnd: "국방부",
  mafra: "농림축산식품부", mcst: "문화체육관광부", moj: "법무부", mohw: "보건복지부",
  motie: "산업통상부", mogef: "성평등가족부", mofa: "외교부", mss: "중소벤처기업부",
  mou: "통일부", moleg: "법제처", mfds: "식품의약품안전처", mpm: "인사혁신처",
  kma: "기상청", khs: "국가유산청", rda: "농촌진흥청", npa: "경찰청",
  dapa: "방위사업청", mma: "병무청", kfs: "산림청", nfa: "소방청",
  oka: "재외동포청", pps: "조달청", kdca: "질병관리청", kostat: "국가데이터처",
  kipo: "지식재산처", kcg: "해양경찰청", naacc: "행정중심복합도시건설청",
}

/** 옛 이름·약칭 → 코드. 개편 전 이름으로 묻는 경우가 많아 받아 준다 */
const MINISTRY_ALIASES: Readonly<Record<string, string>> = {
  행안부: "mois", 국토부: "molit", 기획재정부: "moef", 기재부: "moef", 고용부: "moel", 노동부: "moel",
  환경부: "me", 산업통상자원부: "motie", 산업부: "motie", 여성가족부: "mogef", 여가부: "mogef",
  복지부: "mohw", 해수부: "mof", 농식품부: "mafra", 문체부: "mcst", 과기정통부: "msit", 중기부: "mss",
  보훈부: "mpva", 국가보훈처: "mpva", 식약처: "mfds", 인사처: "mpm", 문화재청: "khs", 특허청: "kipo",
  통계청: "kostat", 행복청: "naacc", 해경: "kcg",
}

/** 부처 코드(대소문자 무시)·부처명·옛 이름 → 코드. 모르면 undefined */
export function resolveMinistry(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.replace(/\s+/g, "") : ""
  if (!text) return undefined
  const code = text.toLowerCase().replace(/cgmexpc$/, "")
  if (CGM_EXPC_MINISTRIES[code]) return code
  return Object.keys(CGM_EXPC_MINISTRIES).find(k => CGM_EXPC_MINISTRIES[k] === text) ?? MINISTRY_ALIASES[text]
}

/** target(`molitCgmExpc`) → 부처명. 목록에 없으면 target 그대로 */
export function ministryLabel(target: string): string {
  return CGM_EXPC_MINISTRIES[target.replace(/CgmExpc$/, "")] ?? target
}

/** ministry 옵션이 비었거나 틀렸을 때 안내 — 코드 목록을 그대로 보여 준다 */
export function ministryListText(): string {
  return Object.entries(CGM_EXPC_MINISTRIES).map(([code, name]) => `${code}=${name}`).join(", ")
}
