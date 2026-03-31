/**
 * 문서 리스크 분석 규칙 엔진
 *
 * 문서 유형 분류, 리스크 규칙 매칭, 금액/기간 추출, 조항 충돌 탐지
 */

// ────────────────────────────────────────
// 문서 유형 분류
// ────────────────────────────────────────

export type DocType =
  | "employment" | "lease" | "service" | "general"
  | "investment" | "nda" | "license" | "construction"

interface Signal { keyword: string; weight: number }

const DOC_SIGNALS: Record<DocType, Signal[]> = {
  employment: [
    { keyword: "근로", weight: 4 }, { keyword: "임금", weight: 3 },
    { keyword: "퇴직", weight: 3 }, { keyword: "사용자", weight: 2 },
    { keyword: "출퇴근", weight: 3 }, { keyword: "4대보험", weight: 3 },
    { keyword: "연차", weight: 3 }, { keyword: "수습", weight: 2 },
    { keyword: "해고", weight: 4 }, { keyword: "근무시간", weight: 3 },
    { keyword: "용역", weight: 2 }, { keyword: "프리랜서", weight: 3 },
    { keyword: "위탁", weight: 2 }, { keyword: "도급", weight: 3 },
  ],
  lease: [
    { keyword: "임대인", weight: 5 }, { keyword: "임차인", weight: 5 },
    { keyword: "보증금", weight: 4 }, { keyword: "전세", weight: 5 },
    { keyword: "월세", weight: 4 }, { keyword: "임대차", weight: 5 },
    { keyword: "명도", weight: 4 }, { keyword: "원상복구", weight: 3 },
    { keyword: "갱신", weight: 2 }, { keyword: "중개", weight: 2 },
  ],
  service: [
    { keyword: "이용약관", weight: 5 }, { keyword: "회원", weight: 2 },
    { keyword: "청약철회", weight: 4 }, { keyword: "환불", weight: 3 },
    { keyword: "면책", weight: 3 }, { keyword: "서비스", weight: 1 },
    { keyword: "개인정보", weight: 3 }, { keyword: "콘텐츠", weight: 2 },
    { keyword: "구독", weight: 3 }, { keyword: "자동결제", weight: 3 },
  ],
  investment: [
    { keyword: "투자", weight: 5 }, { keyword: "출자", weight: 5 },
    { keyword: "지분", weight: 4 }, { keyword: "배당", weight: 4 },
    { keyword: "주식", weight: 3 }, { keyword: "신주", weight: 4 },
    { keyword: "투자금", weight: 5 }, { keyword: "투자자", weight: 4 },
    { keyword: "회수", weight: 2 }, { keyword: "희석", weight: 3 },
    { keyword: "우선매수", weight: 4 }, { keyword: "동반매도", weight: 4 },
  ],
  nda: [
    { keyword: "비밀유지", weight: 5 }, { keyword: "기밀", weight: 5 },
    { keyword: "비밀정보", weight: 5 }, { keyword: "기밀정보", weight: 5 },
    { keyword: "비밀보호", weight: 4 }, { keyword: "누설", weight: 4 },
    { keyword: "유출", weight: 3 }, { keyword: "NDA", weight: 5 },
    { keyword: "비공개", weight: 3 }, { keyword: "수령인", weight: 3 },
  ],
  license: [
    { keyword: "라이선스", weight: 5 }, { keyword: "라이센스", weight: 5 },
    { keyword: "실시권", weight: 5 }, { keyword: "사용허락", weight: 4 },
    { keyword: "로열티", weight: 5 }, { keyword: "사용료", weight: 3 },
    { keyword: "독점적", weight: 3 }, { keyword: "비독점", weight: 3 },
    { keyword: "서브라이선스", weight: 4 }, { keyword: "기술이전", weight: 4 },
  ],
  construction: [
    { keyword: "공사", weight: 5 }, { keyword: "시공", weight: 5 },
    { keyword: "건설", weight: 4 }, { keyword: "도급", weight: 4 },
    { keyword: "하도급", weight: 5 }, { keyword: "준공", weight: 5 },
    { keyword: "공사대금", weight: 5 }, { keyword: "기성금", weight: 4 },
    { keyword: "착공", weight: 4 }, { keyword: "설계변경", weight: 4 },
    { keyword: "하자보수", weight: 4 }, { keyword: "공정", weight: 2 },
  ],
  general: [],
}

export const DOC_LABELS: Record<DocType, string> = {
  employment: "근로/용역 계약",
  lease: "임대차 계약",
  service: "서비스 이용약관",
  investment: "투자 계약",
  nda: "비밀유지계약(NDA)",
  license: "라이선스/기술이전 계약",
  construction: "건설/공사 계약",
  general: "일반 계약",
}

export function classifyDocument(text: string): DocType {
  const scores = Object.fromEntries(
    (Object.keys(DOC_SIGNALS) as DocType[]).map(k => [k, 0])
  ) as Record<DocType, number>

  for (const [type, signals] of Object.entries(DOC_SIGNALS) as [DocType, Signal[]][]) {
    for (const s of signals) {
      if (text.includes(s.keyword)) scores[type] += s.weight
    }
  }

  // 상호 배타 보정
  if (scores.lease > 10) scores.employment -= 5
  if (scores.employment > 10) scores.lease -= 5
  if (scores.construction > 10) scores.lease -= 3

  let best: DocType = "general"
  let bestScore = 3
  for (const [type, score] of Object.entries(scores) as [DocType, number][]) {
    if (score > bestScore) { best = type; bestScore = score }
  }
  return best
}

// ────────────────────────────────────────
// 조항 추출
// ────────────────────────────────────────

export interface Clause {
  label: string
  body: string
}

export function extractClauses(text: string, max: number): Clause[] {
  const clauses: Clause[] = []
  const splits = text.split(/(?=제\s*\d+\s*조(?:의\s*\d+)?)/)

  for (const chunk of splits) {
    if (clauses.length >= max) break
    const labelMatch = chunk.match(/^(제\s*\d+\s*조(?:의\s*\d+)?)\s*/)
    if (!labelMatch) continue

    const label = labelMatch[1].replace(/\s+/g, "")
    const body = chunk.slice(labelMatch[0].length).trim()
    if (body.length > 0) {
      clauses.push({ label, body: body.slice(0, 500) })
    }
  }
  return clauses
}

// ────────────────────────────────────────
// 리스크 규칙
// ────────────────────────────────────────

export interface RiskRule {
  id: string
  name: string
  requires: string[]
  anyOf?: string[]
  severity: "high" | "medium"
  description: string
  searchHints: string[]
}

export const RISK_RULES: RiskRule[] = [
  {
    id: "unilateral_termination",
    name: "일방 해지 조항",
    requires: ["해지"],
    anyOf: ["즉시", "일방", "통보만으로", "사전 통지 없이"],
    severity: "high",
    description: "해지 사유/절차가 불명확하거나 일방에게 과도하게 유리할 수 있음",
    searchHints: ["민법 해지 통고 기간", "근로기준법 해고 예고"],
  },
  {
    id: "deposit_return",
    name: "보증금 반환 조건",
    requires: ["보증금"],
    anyOf: ["반환", "돌려", "정산"],
    severity: "high",
    description: "보증금 반환 시기/조건이 불명확하면 분쟁 원인",
    searchHints: ["주택임대차보호법 보증금", "임대차 보증금 반환 판례"],
  },
  {
    id: "liability_exemption",
    name: "과도한 면책",
    requires: [],
    anyOf: ["면책", "책임지지 않", "책임을 지지", "일체의 책임"],
    severity: "high",
    description: "고의/중과실까지 면책하는 조항은 무효 가능성",
    searchHints: ["약관규제법 면책조항", "불공정약관 면책 판례"],
  },
  {
    id: "refund_restriction",
    name: "환불 제한",
    requires: ["환불"],
    anyOf: ["불가", "없다", "않는다", "거부"],
    severity: "high",
    description: "소비자의 청약철회권을 과도하게 제한",
    searchHints: ["전자상거래법 청약철회", "약관규제법 환불"],
  },
  {
    id: "auto_renewal",
    name: "자동 갱신/연장",
    requires: [],
    anyOf: ["자동 갱신", "자동 연장", "자동으로 갱신", "자동으로 연장"],
    severity: "medium",
    description: "해지 의사 없으면 자동 연장되는 조항 -- 고지 의무 확인 필요",
    searchHints: ["자동갱신 약관 고지의무", "임대차 갱신거절권"],
  },
  {
    id: "penalty_clause",
    name: "위약금/손해배상 예정",
    requires: [],
    anyOf: ["위약금", "손해배상 예정", "위약벌", "배액배상"],
    severity: "medium",
    description: "부당하게 과중한 위약금은 감액 청구 가능",
    searchHints: ["민법 제398조 손해배상 예정", "위약금 감액 판례"],
  },
  {
    id: "jurisdiction",
    name: "관할 법원 지정",
    requires: ["관할"],
    anyOf: ["본점", "본사", "회사 소재지", "갑의 소재지"],
    severity: "medium",
    description: "약자에게 불리한 관할 지정 -- 소비자 거주지 관할 원칙 확인",
    searchHints: ["약관규제법 관할합의", "소비자 관할 판례"],
  },
  {
    id: "unilateral_change",
    name: "일방적 조건 변경",
    requires: [],
    anyOf: ["사전고지 없이 변경", "일방적으로 변경", "통보 없이 변경", "임의로 변경"],
    severity: "high",
    description: "상대방 동의 없는 계약 조건 변경은 무효 가능",
    searchHints: ["약관규제법 약관변경 고지", "계약조건 일방변경 판례"],
  },
  {
    id: "non_compete",
    name: "경업금지/전직금지",
    requires: [],
    anyOf: ["경업금지", "전직금지", "경쟁업체", "동종업계"],
    severity: "medium",
    description: "범위/기간이 과도하면 직업 선택의 자유 침해",
    searchHints: ["경업금지 유효요건 판례", "전직금지 합의 효력"],
  },
  {
    id: "ip_transfer",
    name: "지식재산권 일괄 양도",
    requires: [],
    anyOf: ["지식재산권", "저작권", "특허권", "모든 권리"],
    severity: "medium",
    description: "업무 범위를 넘는 포괄적 IP 양도 조항 검토 필요",
    searchHints: ["저작권법 업무상저작물", "직무발명 보상 판례"],
  },
  // ── 투자 계약 ──
  {
    id: "investment_no_exit",
    name: "투자금 회수 제한",
    requires: ["투자"],
    anyOf: ["회수 불가", "환급 불가", "반환하지", "회수할 수 없"],
    severity: "high",
    description: "투자금 회수 조건이 불합리하게 제한됨",
    searchHints: ["상법 출자환급 금지", "투자계약 회수 판례"],
  },
  {
    id: "dilution_no_protect",
    name: "희석방지 조항 부재",
    requires: ["신주"],
    anyOf: ["우선인수", "희석방지", "안티딜루션"],
    severity: "medium",
    description: "신주 발행 시 기존 투자자 지분 희석 방지 장치 확인 필요",
    searchHints: ["투자계약 희석방지 조항", "상법 신주발행 판례"],
  },
  // ── NDA ──
  {
    id: "nda_unlimited_scope",
    name: "비밀정보 범위 무제한",
    requires: [],
    anyOf: ["일체의 정보", "모든 정보를 비밀", "관련 모든"],
    severity: "high",
    description: "비밀정보 범위가 무제한이면 이행 불가능하고 분쟁 원인",
    searchHints: ["비밀유지계약 범위 판례", "NDA 비밀정보 정의"],
  },
  {
    id: "nda_perpetual",
    name: "영구적 비밀유지 의무",
    requires: ["비밀"],
    anyOf: ["영구", "무기한", "기간 제한 없이"],
    severity: "medium",
    description: "비밀유지 기간이 무제한이면 과도한 제한으로 무효 가능",
    searchHints: ["비밀유지의무 기간 판례", "영업비밀 보호기간"],
  },
  // ── 라이선스 ──
  {
    id: "license_auto_terminate",
    name: "라이선스 즉시 종료",
    requires: [],
    anyOf: ["라이선스 즉시 종료", "사용권 즉시 박탈", "허락 즉시 취소"],
    severity: "high",
    description: "경미한 위반에도 라이선스가 즉시 종료되면 과도한 제한",
    searchHints: ["라이선스 해지 판례", "소프트웨어 사용권 종료"],
  },
  // ── 건설/공사 ──
  {
    id: "construction_payment_delay",
    name: "공사대금 지급 지연",
    requires: [],
    anyOf: ["대금 지급을 유보", "기성금 미지급", "준공 후 지급"],
    severity: "high",
    description: "공사대금 지급 지연 조항은 하도급법 위반 가능성",
    searchHints: ["하도급법 대금지급", "건설산업기본법 공사대금"],
  },
  {
    id: "construction_change_order",
    name: "일방적 설계변경",
    requires: [],
    anyOf: ["설계변경", "공사내용 변경"],
    severity: "medium",
    description: "발주자의 일방적 설계변경 시 대금 조정 여부 확인 필요",
    searchHints: ["건설산업기본법 설계변경", "공사계약 설계변경 판례"],
  },
]

export function matchRule(rule: RiskRule, text: string): boolean {
  if (rule.requires.length > 0 && !rule.requires.every(k => text.includes(k))) {
    return false
  }
  if (rule.anyOf && rule.anyOf.length > 0) {
    return rule.anyOf.some(k => text.includes(k))
  }
  return rule.requires.length > 0
}

// ────────────────────────────────────────
// 리스크 점수 산출
// ────────────────────────────────────────

export type RiskGrade = "safe" | "caution" | "warning" | "danger"

const GRADE_LABELS: Record<RiskGrade, string> = {
  safe: "안전",
  caution: "주의",
  warning: "경고",
  danger: "위험",
}

export function computeRiskScore(findings: { severity: "high" | "medium" }[]): {
  score: number
  grade: RiskGrade
  gradeLabel: string
} {
  let score = 0
  for (const f of findings) {
    score += f.severity === "high" ? 3 : 1
  }
  let grade: RiskGrade
  if (score === 0) grade = "safe"
  else if (score <= 3) grade = "caution"
  else if (score <= 8) grade = "warning"
  else grade = "danger"

  return { score, grade, gradeLabel: GRADE_LABELS[grade] }
}

// ────────────────────────────────────────
// 금액/기간 추출
// ────────────────────────────────────────

export interface ExtractedAmount {
  label: string
  value: string
}

export interface ExtractedPeriod {
  label: string
  value: string
}

export function extractAmounts(text: string): ExtractedAmount[] {
  const results: ExtractedAmount[] = []
  const seen = new Set<string>()

  const patterns: { label: string; re: RegExp }[] = [
    { label: "계약금액", re: /계약\s*금액[^0-9]*([0-9,]+\s*(?:원|만원|억원|백만원))/g },
    { label: "위약금", re: /위약금[^0-9]*([0-9,]+\s*(?:원|만원|억원|백만원|%))/g },
    { label: "보증금", re: /보증금[^0-9]*([0-9,]+\s*(?:원|만원|억원|백만원))/g },
    { label: "월세/임대료", re: /(?:월세|임대료|월\s*임대료)[^0-9]*([0-9,]+\s*(?:원|만원|억원|백만원))/g },
    { label: "손해배상", re: /손해배상[^0-9]*([0-9,]+\s*(?:원|만원|억원|백만원|%))/g },
    { label: "투자금", re: /투자금[^0-9]*([0-9,]+\s*(?:원|만원|억원|백만원))/g },
    { label: "로열티", re: /(?:로열티|사용료)[^0-9]*([0-9,]+\s*(?:원|만원|억원|백만원|%))/g },
    { label: "공사대금", re: /(?:공사대금|도급금액)[^0-9]*([0-9,]+\s*(?:원|만원|억원|백만원))/g },
    { label: "기성금", re: /기성금[^0-9]*([0-9,]+\s*(?:원|만원|억원|백만원|%))/g },
    // 일반 금액 (금 OOO원)
    { label: "금액", re: /금\s+([0-9,]+\s*(?:원|만원|억원|백만원))/g },
  ]

  for (const p of patterns) {
    let m: RegExpExecArray | null
    while ((m = p.re.exec(text)) !== null) {
      const key = `${p.label}:${m[1].trim()}`
      if (!seen.has(key)) {
        seen.add(key)
        results.push({ label: p.label, value: m[1].trim() })
      }
    }
  }
  return results
}

export function extractPeriods(text: string): ExtractedPeriod[] {
  const results: ExtractedPeriod[] = []
  const seen = new Set<string>()

  const patterns: { label: string; re: RegExp }[] = [
    { label: "계약기간", re: /계약\s*기간[^0-9]*([0-9]+\s*(?:년|개월|일|주))/g },
    { label: "해지 통보 기간", re: /(?:해지|해약)\s*(?:통보|통지|고지)[^0-9]*([0-9]+\s*(?:일|개월|주)\s*(?:전|이전)?)/g },
    { label: "비밀유지 기간", re: /비밀\s*유지\s*기간[^0-9]*([0-9]+\s*(?:년|개월))/g },
    { label: "경업금지 기간", re: /(?:경업금지|전직금지)\s*기간[^0-9]*([0-9]+\s*(?:년|개월))/g },
    { label: "보증기간", re: /(?:보증|하자보수)\s*기간[^0-9]*([0-9]+\s*(?:년|개월|일))/g },
    { label: "공사기간", re: /공사\s*기간[^0-9]*([0-9]+\s*(?:년|개월|일))/g },
    // 일반 기간 (YYYY.MM.DD ~ YYYY.MM.DD)
    { label: "기간", re: /(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*[~부]\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/g },
  ]

  for (const p of patterns) {
    let m: RegExpExecArray | null
    while ((m = p.re.exec(text)) !== null) {
      const key = `${p.label}:${m[1].trim()}`
      if (!seen.has(key)) {
        seen.add(key)
        results.push({ label: p.label, value: m[1].trim() })
      }
    }
  }
  return results
}

// ────────────────────────────────────────
// 조항 간 충돌 탐지
// ────────────────────────────────────────

export interface ConflictResult {
  type: string
  description: string
  clauseA?: string
  clauseB?: string
}

interface ConflictRule {
  type: string
  description: string
  /** 조항 A 패턴 */
  patternA: RegExp
  /** 조항 B 패턴 (A와 같은 문서 내에서 충돌) */
  patternB: RegExp
}

const CONFLICT_RULES: ConflictRule[] = [
  {
    type: "해지통보 vs 즉시해지",
    description: "사전통보 기간이 있는데 즉시해지도 가능 -- 어느 조항이 우선인지 불명확",
    patternA: /(?:해지|해약)\s*(?:통보|통지|고지)\s*.*\d+\s*(?:일|개월)\s*(?:전|이전)/,
    patternB: /즉시\s*해지|사전\s*통지\s*없이\s*해지|통보\s*없이\s*해지/,
  },
  {
    type: "자동갱신 vs 계약기간 확정",
    description: "계약기간이 확정인데 자동갱신 조항도 있음 -- 종료 시점 혼란",
    patternA: /계약\s*기간.*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*(?:까지|만료)/,
    patternB: /자동\s*(?:갱신|연장)/,
  },
  {
    type: "면책 vs 손해배상",
    description: "면책 조항과 손해배상 조항이 공존 -- 면책 범위와 배상 의무가 충돌할 수 있음",
    patternA: /일체의?\s*책임.*(?:지지|않|없)/,
    patternB: /손해배상.*(?:하여야|책임|배상)/,
  },
  {
    type: "독점 vs 제3자 허용",
    description: "독점 조항인데 제3자 사용 허용도 언급 -- 독점 범위 불명확",
    patternA: /독점적\s*(?:사용|실시|라이선스)/,
    patternB: /제3자.*(?:허용|허락|사용할 수 있|재실시)/,
  },
]

export function detectConflicts(clauses: Clause[]): ConflictResult[] {
  const results: ConflictResult[] = []
  if (clauses.length < 2) return results

  for (const rule of CONFLICT_RULES) {
    let matchA: Clause | undefined
    let matchB: Clause | undefined

    for (const c of clauses) {
      if (!matchA && rule.patternA.test(c.body)) matchA = c
      if (!matchB && rule.patternB.test(c.body)) matchB = c
    }

    if (matchA && matchB && matchA.label !== matchB.label) {
      results.push({
        type: rule.type,
        description: rule.description,
        clauseA: matchA.label,
        clauseB: matchB.label,
      })
    }
  }
  return results
}

/** 전문 텍스트 대상 충돌 탐지 (조항 구분 불가 시) */
export function detectConflictsInText(text: string): ConflictResult[] {
  const results: ConflictResult[] = []
  for (const rule of CONFLICT_RULES) {
    if (rule.patternA.test(text) && rule.patternB.test(text)) {
      results.push({ type: rule.type, description: rule.description })
    }
  }
  return results
}

// ────────────────────────────────────────
// 문서 유형별 추천 검색어
// ────────────────────────────────────────

export const SEARCH_SUGGESTIONS: Record<DocType, string[]> = {
  employment: [
    "근로기준법 근로계약", "근로자성 판단기준 판례",
    "최저임금법", "퇴직급여보장법",
  ],
  lease: [
    "주택임대차보호법", "상가임대차보호법",
    "임대차 보증금 반환 판례", "임차인 갱신거절권",
  ],
  service: [
    "약관규제법 불공정약관", "전자상거래법 청약철회",
    "개인정보보호법 동의", "소비자기본법",
  ],
  investment: [
    "상법 주주간계약", "벤처투자법",
    "투자계약 회수조건 판례", "주주간 합의 효력",
  ],
  nda: [
    "부정경쟁방지법 영업비밀", "비밀유지계약 효력 판례",
    "산업기술보호법", "영업비밀 침해 손해배상",
  ],
  license: [
    "특허법 실시권", "저작권법 이용허락",
    "기술이전촉진법", "라이선스 계약 판례",
  ],
  construction: [
    "건설산업기본법", "하도급법 대금지급",
    "건설공사 하자보수 판례", "공사대금 지급 판례",
  ],
  general: [
    "민법 계약 해석", "약관규제법",
  ],
}
