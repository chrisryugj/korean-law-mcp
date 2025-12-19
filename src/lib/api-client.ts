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
      throw new Error("법령을 찾을 수 없습니다. MST 또는 법령명을 확인해주세요.")
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
      type: "JSON",
      ID: id,
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
   */
  async getAnnexes(params: {
    lawName: string
    knd?: "1" | "2" | "3" | "4" | "5"
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "annex",
      OC: this.apiKey,
      type: "JSON",
      lawNm: params.lawName,
    })

    if (params.knd) apiParams.append("knd", params.knd)

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
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
      ordinSeq: ordinSeq,
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
}
