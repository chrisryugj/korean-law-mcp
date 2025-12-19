/**
 * 3단비교 데이터 타입 정의
 */

export interface ThreeTierMeta {
  lawId: string
  lawName: string
  lawSummary: string
  sihyungryungId: string
  sihyungryungName: string
  sihyungryungSummary: string
  sihyungkyuchikId: string
  sihyungkyuchikName: string
  sihyungkyuchikSummary: string
  exists: boolean
  basis: string
}

export interface DelegationItem {
  type: "시행령" | "시행규칙" | "행정규칙"
  lawName: string
  jo?: string
  joNum?: string
  title: string
  content: string
}

export interface CitationItem {
  type: string
  lawName: string
  jo?: string
  joNum?: string
  title: string
  content: string
}

export interface ThreeTierArticle {
  jo: string
  joNum: string
  title: string
  content: string
  delegations: DelegationItem[]
  citations: CitationItem[]
}

export interface ThreeTierData {
  meta: ThreeTierMeta
  articles: ThreeTierArticle[]
  kndType: "위임조문" | "인용조문"
}
