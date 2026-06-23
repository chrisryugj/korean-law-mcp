/**
 * 법제처 API 클라이언트
 */

import { normalizeLawSearchText, resolveLawAlias } from "./search-normalizer.js"
import { fetchWithRetry } from "./fetch-with-retry.js"
import { requestContext } from "./session-state.js"
import { getLawApiBaseUrl } from "./law-url-config.js"

const LAW_API_BASE = getLawApiBaseUrl()

export class LawApiClient {
  private defaultApiKey: string

  constructor(config: { apiKey: string }) {
    this.defaultApiKey = config.apiKey
  }

  /**
   * API 키 결정 순서:
   * 1. 요청별 override 키
   * 2. 현재 요청 컨텍스트의 API 키 (HTTP stateless 모드)
   * 3. 환경변수 LAW_OC
   * 4. 생성자에서 받은 기본 키
   */
  private getApiKey(overrideKey?: string): string {
    const ctxApiKey = requestContext.getStore()?.apiKey
    const key = overrideKey || ctxApiKey || process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || this.defaultApiKey
    if (!key) {
      throw new Error("API 키가 필요합니다. 법제처(https://open.law.go.kr/LSO/openApi/guideResult.do)에서 발급받으세요.")
    }
    return key
  }

  /** HTTP 응답 검증 — 상태 코드 분류 + HTML 에러 페이지 감지 */
  private async throwIfError(response: Response, endpoint: string): Promise<void> {
    if (!response.ok) {
      // body stream 리크 방지: throw 전에 body consume
      try { await response.text() } catch { /* ignore */ }
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
   * 빈 응답 감지 — 법제처가 간헐 장애 시 200으로 빈 본문을 반환하는 케이스.
   * 그대로 XML 파서에 넘기면 "missing root element"로 터지므로 명확한 메시지로 전환.
   * (fetchWithRetry가 빈/HTML 응답을 재시도하지만, 재시도 소진 후에도 빈 응답이면 여기서 처리)
   */
  private checkEmptyResponse(text: string, context: string): void {
    if (!text || !text.trim()) {
      throw new Error(`${context} - 법제처 API가 빈 응답을 반환했습니다. 일시적 장애일 수 있으니 잠시 후 다시 시도하세요.`)
    }
  }

  /**
   * 법령 검색
   * @param display 결과 개수 (기본값 법제처 API default, 짧은 법령명("상법" 등) 정확 매칭 찾으려면 큰 값 권장)
   */
  async searchLaw(query: string, apiKey?: string, display?: number): Promise<string> {
    const normalizedQuery = normalizeLawSearchText(query)
    const aliasResolution = resolveLawAlias(normalizedQuery)
    const finalQuery = aliasResolution.canonical

    const params = new URLSearchParams({
      OC: this.getApiKey(apiKey),
      type: this.getResponseType(),
      target: "law",
      query: finalQuery,
    })
    if (display && display > 0) params.append("display", String(display))

    const url = `${LAW_API_BASE}/lawSearch.do?${params.toString()}`
    const response = await fetchWithRetry(url)
    await this.throwIfError(response, "searchLaw")

    const text = await response.text()
    this.checkEmptyResponse(text, "법령 검색")
    this.checkHtmlError(text, "법령 검색 결과를 받지 못했습니다")
    return text
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
    await this.throwIfError(response, "getLawText")

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
    await this.throwIfError(response, "compareOldNew")

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
    await this.throwIfError(response, "getThreeTier")

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
    await this.throwIfError(response, "searchAdminRule")

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
    await this.throwIfError(response, "getAdminRule")

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
    await this.throwIfError(response, "getAnnexes")

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

    // 시행령/시행규칙이 있으면 일반 법령 ("령"만으로는 판별 불가 — "복무규정", "관리령" 등 행정규칙 오분류 방지)
    if (/시행령|시행규칙/.test(lawName)) {
      return 'law'
    }

    // 행정규칙: 훈령, 예규, 고시, 지침, 내규, 세칙 (규정/규칙 단독은 시행규칙 오분류 위험 → 4차 fallback에 위임)
    if (/훈령|예규|고시|지침|내규|세칙/.test(lawName)) {
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
    await this.throwIfError(response, "searchOrdinance")

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
    await this.throwIfError(response, "getOrdinance")

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
    await this.throwIfError(response, "getArticleHistory")

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
    await this.throwIfError(response, `fetchApi(${params.target})`)

    const text = await response.text()
    // type=HTML 응답은 HTML이 정상 — checkHtmlError(XML/JSON 응답에 HTML이 오면 에러) 우회
    if (params.type !== "HTML") {
      this.checkHtmlError(text, "API 응답 오류 - 파라미터를 확인해주세요")
    }

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
    await this.throwIfError(response, "getLawHistory")

    return await response.text()
  }
}
