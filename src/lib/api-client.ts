/**
 * 법제처 API 클라이언트
 */

import { normalizeLawSearchText, resolveLawAlias } from "./search-normalizer.js"

const LAW_API_BASE = "https://www.law.go.kr/DRF"

export class LawApiClient {
  private apiKey: string

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey
  }

  /**
   * 법령 검색
   */
  async searchLaw(query: string): Promise<string> {
    const normalizedQuery = normalizeLawSearchText(query)
    const aliasResolution = resolveLawAlias(normalizedQuery)
    const finalQuery = aliasResolution.canonical

    const params = new URLSearchParams({
      OC: this.apiKey,
      type: "XML",
      target: "law",
      query: finalQuery,
    })

    const url = `${LAW_API_BASE}/lawSearch.do?${params.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return await response.text()
  }

  /**
   * 현행법령 조회
   */
  async getLawText(params: {
    mst?: string
    lawId?: string
    jo?: string
    efYd?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "eflaw",
      OC: this.apiKey,
      type: "JSON",
    })

    if (params.mst) apiParams.append("MST", params.mst)
    if (params.lawId) apiParams.append("ID", params.lawId)
    if (params.jo) apiParams.append("JO", params.jo)
    if (params.efYd) apiParams.append("efYd", params.efYd)

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const text = await response.text()

    if (text.includes("<!DOCTYPE html") || text.includes("<html")) {
      // 에러 메시지에 fallback 전략 포함
      let errorMsg = "법령을 찾을 수 없습니다."

      if (params.jo) {
        errorMsg += "\n\n💡 개선 방법:"
        errorMsg += "\n   1. jo 파라미터를 생략하여 전체 법령 조회"
        errorMsg += "\n   2. search_all 도구로 키워드 검색"
        errorMsg += "\n   3. 법령명이 정확한지 확인 (예: 약사법 시행령은 제1~39조만 존재)"
      } else {
        errorMsg += " MST 또는 법령명을 확인해주세요."
      }

      throw new Error(errorMsg)
    }

    return text
  }

  /**
   * 신구법 대조
   */
  async compareOldNew(params: {
    mst?: string
    lawId?: string
    ld?: string
    ln?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "oldAndNew",
      OC: this.apiKey,
      type: "XML",
    })

    if (params.mst) apiParams.append("MST", params.mst)
    if (params.lawId) apiParams.append("ID", params.lawId)
    if (params.ld) apiParams.append("LD", params.ld)
    if (params.ln) apiParams.append("LN", params.ln)

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return await response.text()
  }

  /**
   * 3단비교 (위임조문)
   */
  async getThreeTier(params: {
    mst?: string
    lawId?: string
    knd?: "1" | "2"
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "thdCmp",
      OC: this.apiKey,
      type: "JSON",
      knd: params.knd || "2", // 기본값: 위임조문
    })

    if (params.mst) apiParams.append("MST", params.mst)
    if (params.lawId) apiParams.append("ID", params.lawId)

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return await response.text()
  }

  /**
   * 행정규칙 검색
   */
  async searchAdminRule(params: {
    query: string
    knd?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      OC: this.apiKey,
      type: "XML",
      target: "admrul",
      query: params.query,
    })

    if (params.knd) apiParams.append("knd", params.knd)

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return await response.text()
  }

  /**
   * 행정규칙 조회
   */
  async getAdminRule(id: string): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "admrul",
      OC: this.apiKey,
      type: "XML",  // 행정규칙은 XML만 지원
      ID: id,  // 행정규칙일련번호 사용
    })

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const text = await response.text()

    if (text.includes("<!DOCTYPE html") || text.includes("<html")) {
      throw new Error("행정규칙을 찾을 수 없습니다. ID를 확인해주세요.")
    }

    return text
  }

  /**
   * 별표/서식 조회
   * LexDiff 방식: lawSearch.do + target=licbyl
   */
  async getAnnexes(params: {
    lawName: string
    knd?: "1" | "2" | "3" | "4" | "5"
  }): Promise<string> {
    // 법령 종류 판별
    const lawType = this.detectLawType(params.lawName)
    const targetMap = {
      law: "licbyl",
      ordinance: "ordinbyl",
      admin: "admbyl",
    }
    const target = targetMap[lawType]

    const apiParams = new URLSearchParams({
      target,
      OC: this.apiKey,
      type: "JSON",
      query: params.lawName,
      search: "2", // 해당법령으로 검색
      display: "100", // 최대 100개
    })

    // 일반 법령만 knd 필터 적용
    if (lawType === 'law' && params.knd) {
      apiParams.set("knd", params.knd)
    }

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return await response.text()
  }

  /**
   * 법령 종류 판별
   */
  private detectLawType(lawName: string): 'law' | 'ordinance' | 'admin' {
    // 조례/규칙 판별 (자치법규)
    if (/조례/.test(lawName) ||
      /(특별시|광역시|도|시|군|구)\s+[가-힣]+\s*(조례|규칙)/.test(lawName)) {
      return 'ordinance'
    }

    // 시행령/시행규칙/령이 있으면 일반 법령
    if (/(시행령|시행규칙|령)/.test(lawName)) {
      return 'law'
    }

    // 행정규칙: 훈령, 예규, 고시, 지침, 내규
    if (/훈령|예규|고시|지침|내규/.test(lawName)) {
      return 'admin'
    }

    // 일반 법령 (법, 규정 등)
    return 'law'
  }

  /**
   * 자치법규 검색
   */
  async searchOrdinance(params: {
    query: string
    display?: number
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "ordin",
      OC: this.apiKey,
      type: "XML",
      query: params.query,
      display: (params.display || 20).toString(),
    })

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return await response.text()
  }

  /**
   * 자치법규 조회
   */
  async getOrdinance(ordinSeq: string): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "ordin",
      OC: this.apiKey,
      type: "JSON",
      MST: ordinSeq,  // ← 파라미터는 MST를 사용해야 함
    })

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const text = await response.text()

    if (text.includes("<!DOCTYPE html") || text.includes("<html")) {
      throw new Error("자치법규를 찾을 수 없습니다. ordinSeq를 확인해주세요.")
    }

    return text
  }

  /**
   * 일자별 조문 개정 이력 조회
   */
  async getArticleHistory(params: {
    lawId?: string
    jo?: string
    regDt?: string
    fromRegDt?: string
    toRegDt?: string
    org?: string
    page?: number
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "lsJoHstInf",
      OC: this.apiKey,
      type: "XML",
    })

    if (params.lawId) apiParams.append("ID", params.lawId)
    if (params.jo) apiParams.append("JO", params.jo)
    if (params.regDt) apiParams.append("regDt", params.regDt)
    if (params.fromRegDt) apiParams.append("fromRegDt", params.fromRegDt)
    if (params.toRegDt) apiParams.append("toRegDt", params.toRegDt)
    if (params.org) apiParams.append("org", params.org)
    if (params.page) apiParams.append("page", params.page.toString())

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return await response.text()
  }

  /**
   * 법령 변경이력 목록 조회
   */
  async getLawHistory(params: {
    regDt: string
    org?: string
    display?: number
    page?: number
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "lsHstInf",
      OC: this.apiKey,
      type: "XML",
      regDt: params.regDt,
    })

    if (params.org) apiParams.append("org", params.org)
    if (params.display) apiParams.append("display", params.display.toString())
    if (params.page) apiParams.append("page", params.page.toString())

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return await response.text()
  }
}
