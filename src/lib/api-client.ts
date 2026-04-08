/**
 * 법제처 API 클라이언트
 */

import { normalizeLawSearchText, resolveLawAlias } from "./search-normalizer.js"
import { fetchWithRetry } from "./fetch-with-retry.js"
import { sessionStore, getSessionApiKey } from "./session-state.js"

const LAW_API_BASE = "https://www.law.go.kr/DRF"

export class LawApiClient {
  private defaultApiKey: string

  constructor(config: { apiKey: string }) {
    this.defaultApiKey = config.apiKey
  }

  /**
   * API 키 결정 순서:
   * 1. 요청별 override 키
   * 2. 현재 세션의 API 키 (HTTP 모드)
   * 3. 환경변수 LAW_OC
   * 4. 생성자에서 받은 기본 키
   */
  private getApiKey(overrideKey?: string): string {
    const currentSessionId = sessionStore.getStore()
    const sessionApiKey = currentSessionId ? getSessionApiKey(currentSessionId) : undefined
    const key = overrideKey || sessionApiKey || process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || this.defaultApiKey
    if (!key) {
      throw new Error("API 키가 필요합니다. 법제처(https://open.law.go.kr/LSO/openApi/guideResult.do)에서 발급받으세요.")
    }
    return key
  }

  /** HTTP 응답 검증 — 상태 코드 분류 + HTML 에러 페이지 감지 */
  private throwIfError(response: Response, endpoint: string): void {
    if (!response.ok) {
      const status = response.status
      if (status === 429) throw new Error(`API 요청 한도 초과 (429) - 잠시 후 다시 시도하세요.`)
      if (status >= 500) throw new Error(`법제처 서버 오류 (${status}) - ${endpoint}`)
      throw new Error(`API 오류 (${status}) - ${endpoint}`)
    }
  }

  /** 현재 응답 타입 반환 (환경변수 LAW_RESPONSE_TYPE, 기본값 XML) */
  private getResponseType(): "XML" | "JSON" {
    const t = (process.env.LAW_RESPONSE_TYPE || "XML").toUpperCase()
    return t === "JSON" ? "JSON" : "XML"
  }

  /** 응답 본문이 HTML 에러 페이지인지 확인 */
  private checkHtmlError(text: string, context: string): void {
    if (text.includes("<!DOCTYPE html") || text.includes("<html")) {
      const hint = this.getResponseType() === "XML"
        ? " XML 엔드포인트 장애 시 LAW_RESPONSE_TYPE=JSON 환경변수로 우회할 수 있습니다."
        : ""
      throw new Error(`${context} - API가 HTML 에러 페이지를 반환했습니다. 파라미터를 확인해주세요.${hint}`)
    }
  }

  /**
   * 법령 검색
   */
  async searchLaw(query: string, apiKey?: string): Promise<string> {
    const normalizedQuery = normalizeLawSearchText(query)
    const aliasResolution = resolveLawAlias(normalizedQuery)
    const finalQuery = aliasResolution.canonical

    const params = new URLSearchParams({
      OC: this.getApiKey(apiKey),
      type: this.getResponseType(),
      target: "law",
      query: finalQuery,
    })

    const url = `${LAW_API_BASE}/lawSearch.do?${params.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "searchLaw")

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
    apiKey?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "eflaw",
      OC: this.getApiKey(params.apiKey),
      type: "JSON",
    })

    if (params.mst) apiParams.append("MST", String(params.mst))
    if (params.lawId) apiParams.append("ID", String(params.lawId))
    if (params.jo) apiParams.append("JO", String(params.jo))
    if (params.efYd) apiParams.append("efYd", String(params.efYd))

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "getLawText")

    const text = await response.text()

    this.checkHtmlError(text, params.jo
      ? `법령 조문(${params.jo})을 찾을 수 없습니다. MST/lawId와 조문번호를 확인해주세요.`
      : "법령을 찾을 수 없습니다. MST 또는 법령명을 확인해주세요.")

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
    apiKey?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "oldAndNew",
      OC: this.getApiKey(params.apiKey),
      type: this.getResponseType(),
    })

    if (params.mst) apiParams.append("MST", String(params.mst))
    if (params.lawId) apiParams.append("ID", String(params.lawId))
    if (params.ld) apiParams.append("LD", String(params.ld))
    if (params.ln) apiParams.append("LN", String(params.ln))

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "compareOldNew")

    return await response.text()
  }

  /**
   * 3단비교 (위임조문)
   */
  async getThreeTier(params: {
    mst?: string
    lawId?: string
    knd?: "1" | "2"
    apiKey?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "thdCmp",
      OC: this.getApiKey(params.apiKey),
      type: "JSON",
      knd: params.knd || "2",
    })

    if (params.mst) apiParams.append("MST", String(params.mst))
    if (params.lawId) apiParams.append("ID", String(params.lawId))

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "getThreeTier")

    return await response.text()
  }

  /**
   * 행정규칙 검색
   */
  async searchAdminRule(params: {
    query: string
    knd?: string
    apiKey?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      OC: this.getApiKey(params.apiKey),
      type: this.getResponseType(),
      target: "admrul",
      query: params.query,
    })

    if (params.knd) apiParams.append("knd", params.knd)

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "searchAdminRule")

    return await response.text()
  }

  /**
   * 행정규칙 조회
   */
  async getAdminRule(id: string, apiKey?: string): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "admrul",
      OC: this.getApiKey(apiKey),
      type: this.getResponseType(),
      ID: id,
    })

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "getAdminRule")

    const text = await response.text()
    this.checkHtmlError(text, "행정규칙을 찾을 수 없습니다. ID를 확인해주세요")

    return text
  }

  /**
   * 별표/서식 조회
   * LexDiff 방식: lawSearch.do + target=licbyl
   */
  async getAnnexes(params: {
    lawName: string
    knd?: "1" | "2" | "3" | "4" | "5"
    apiKey?: string
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
      OC: this.getApiKey(params.apiKey),
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
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "getAnnexes")

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
    apiKey?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "ordin",
      OC: this.getApiKey(params.apiKey),
      type: this.getResponseType(),
      query: params.query,
      display: (params.display || 20).toString(),
    })

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "searchOrdinance")

    return await response.text()
  }

  /**
   * 자치법규 조회
   */
  async getOrdinance(ordinSeq: string, jo?: string, apiKey?: string): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "ordin",
      OC: this.getApiKey(apiKey),
      type: "JSON",
      MST: ordinSeq,
    })
    if (jo) apiParams.append("JO", jo)

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "getOrdinance")

    const text = await response.text()
    this.checkHtmlError(text, "자치법규를 찾을 수 없습니다. ordinSeq를 확인해주세요")

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
    apiKey?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "lsJoHstInf",
      OC: this.getApiKey(params.apiKey),
      type: this.getResponseType(),
    })

    if (params.lawId) apiParams.append("ID", String(params.lawId))
    if (params.jo) apiParams.append("JO", String(params.jo))
    if (params.regDt) apiParams.append("regDt", String(params.regDt))
    if (params.fromRegDt) apiParams.append("fromRegDt", String(params.fromRegDt))
    if (params.toRegDt) apiParams.append("toRegDt", String(params.toRegDt))
    if (params.org) apiParams.append("org", String(params.org))
    if (params.page) apiParams.append("page", params.page.toString())

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "getArticleHistory")

    return await response.text()
  }

  /**
   * 범용 API 호출 (fetchWithRetry 기반)
   */
  async fetchApi(params: {
    endpoint: "lawSearch.do" | "lawService.do"
    target: string
    type?: "XML" | "JSON" | "HTML"
    extraParams?: Record<string, string>
    apiKey?: string
  }): Promise<string> {
    const init: Record<string, string> = {
      OC: this.getApiKey(params.apiKey),
      target: params.target,
    }
    if (params.type) init.type = params.type
    const apiParams = new URLSearchParams(init)

    if (params.extraParams) {
      for (const [key, value] of Object.entries(params.extraParams)) {
        apiParams.append(key, String(value))
      }
    }

    const url = `${LAW_API_BASE}/${params.endpoint}?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, `fetchApi(${params.target})`)

    const text = await response.text()
    this.checkHtmlError(text, "API 응답 오류 - 파라미터를 확인해주세요")

    return text
  }

  /**
   * 법령 변경이력 목록 조회
   */
  async getLawHistory(params: {
    regDt: string
    org?: string
    display?: number
    page?: number
    apiKey?: string
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "lsHstInf",
      OC: this.getApiKey(params.apiKey),
      type: this.getResponseType(),
      regDt: params.regDt,
    })

    if (params.org) apiParams.append("org", params.org)
    if (params.display) apiParams.append("display", params.display.toString())
    if (params.page) apiParams.append("page", params.page.toString())

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url)
    this.throwIfError(response, "getLawHistory")

    return await response.text()
  }
}
