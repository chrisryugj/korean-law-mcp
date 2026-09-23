/**
 * 법제처 API 클라이언트
 */

import { normalizeLawSearchText, resolveLawAlias } from "./search-normalizer.js"
import { fetchWithRetry } from "./fetch-with-retry.js"
import { readResponseText } from "./response-body.js"
import { isBlankBody, isHtmlPage } from "./body-shape.js"

// 법제처 DRF는 정상 파라미터에도 연속 호출 버스트에 간헐 404를 낸다
// (2026-07-19 행위시법 골드셋 R1에서 19콜 중 10콜 관측, 수초 내 자연 회복 —
// lsHistory 페이징 연속 조회에서 특히 빈발). DRF 엔드포인트는 고정이라
// 영구 404가 사실상 없으므로 404를 재시도 대상에 포함한다.
const DRF_RETRY = { retryOn: [404, 429, 503, 504] }

// `lawService.do` 단건 조회 중 "그 레코드 없음"이 200 + 빈 본문/안내 페이지로 오는
// 조합은 실측표상 **prec·thdCmp·lsStmd 뿐**이다(upstream-miss.ts 주석). 그 경로에서는
// 재시도 사다리를 완주해도 같은 답이므로 확인 1회로 끊는다. 그 밖의 target(law·eflaw·
// ordin·admrul·oldAndNew 등)과 검색(`lawSearch.do`)은 미스도 정상 봉투로 오므로 이
// 배선을 하지 않는다 — 거기 빈 본문은 진짜 장애라 기존 사다리가 방어 역할을 한다.
// endpoint 단위로 켜면 target=law까지 사다리가 2회로 잘리고, 오류 문안에 "자료가
// 실제로 없음"이라는 부존재 후보가 섞인다(#150).
const DRF_LOOKUP_RETRY = { ...DRF_RETRY, singleRecordLookup: true }
const MISS_AS_BAD_BODY_TARGETS = new Set(["prec", "thdCmp", "lsStmd"])
const lookupRetryFor = (target: string) =>
  MISS_AS_BAD_BODY_TARGETS.has(target) ? DRF_LOOKUP_RETRY : DRF_RETRY
import { requestContext } from "./session-state.js"
import { getLawApiBaseUrl } from "./law-url-config.js"

const LAW_API_BASE = getLawApiBaseUrl()

/**
 * JSON 본문에 법령 노드가 실제로 있는지 — getLawText의 eflaw→law 폴백 판정 전용.
 * 파싱 불가 본문은 true(폴백 안 함)로 두어, 형식이 다른 정상 응답을 폴백이
 * 덮어쓰지 않게 한다 (폴백은 "확실히 빈 봉투"에만 발동).
 */
export function hasLawNode(text: string): boolean {
  try {
    const json = JSON.parse(text)
    return json !== null && typeof json === "object" && "법령" in json
  } catch {
    return true
  }
}

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
      try { await readResponseText(response) } catch { /* ignore */ }
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

  /**
   * 응답 본문이 HTML 에러 페이지인지 확인 (술어는 body-shape.ts 단일 원본)
   *
   * 한때 XML 호출 실패에 "LAW_RESPONSE_TYPE=JSON 으로 우회하라"는 안내를 붙였으나 뺐다.
   * 그 환경변수는 정확히 이 XML 메서드들을 JSON 으로 바꾸는데, 그 소비자들은 JSON 을
   * 파싱하지 못한다. 안내를 따르면 더 나빠지는 안내였다(2026-09-23 리뷰 D7).
   */
  private checkHtmlError(text: string, context: string): void {
    if (isHtmlPage(text)) {
      throw new Error(`${context} - API가 HTML 에러 페이지를 반환했습니다. 파라미터를 확인해주세요.`)
    }
  }

  /**
   * 빈 응답 감지 — 법제처가 간헐 장애 시 200으로 빈 본문을 반환하는 케이스.
   * 그대로 XML 파서에 넘기면 "missing root element"로 터지므로 명확한 메시지로 전환.
   * (fetchWithRetry가 빈/HTML 응답을 재시도하지만, 재시도 소진 후에도 빈 응답이면 여기서 처리)
   */
  private checkEmptyResponse(text: string, context: string): void {
    if (isBlankBody(text)) {
      throw new Error(`${context} - 법제처 API가 빈 응답을 반환했습니다. 일시적 장애일 수 있으니 잠시 후 다시 시도하세요.`)
    }
  }

  /**
   * 응답 본문 읽기의 단일 통로. 빈 본문과 HTML 안내 페이지는 여기서 걸린다. 파서까지
   * 내려가면 원인(업스트림 빈 응답·점검 페이지)이 증상("missing root element", "0건")으로
   * 바뀌어 진단이 어려워진다. 메서드마다 가드를 손으로 붙이면 새 메서드에서 잊힌다:
   * HTML 가드는 searchLaw·getAnnexes 에만 있었고 행정규칙·자치법규 검색, 연혁, 신구대조,
   * 3단비교는 점검 페이지를 "검색 결과 없음"으로 내보냈다(2026-09-23 리뷰 D7, 재현).
   *
   * @param htmlContext HTML 페이지일 때 오류 문구. null 이면 HTML 을 정상 응답으로 받는다(type=HTML)
   */
  private async readBody(
    response: Response,
    context: string,
    htmlContext: string | null = `${context} 결과를 받지 못했습니다`,
  ): Promise<string> {
    const text = await readResponseText(response)
    this.checkEmptyResponse(text, context)
    if (htmlContext !== null) this.checkHtmlError(text, htmlContext)
    return text
  }

  /**
   * 법령 검색
   * @param display 결과 개수 (기본값 법제처 API default, 짧은 법령명("상법" 등) 정확 매칭 찾으려면 큰 값 권장)
   * @param target "law"=현행법령(기본), "eflaw"=시행일 기준(시행예정 포함)
   * @param nw eflaw 전용 현행연혁 필터 (1=연혁, 2=시행예정, 3=현행). 미지정이면 전체
   */
  async searchLaw(query: string, apiKey?: string, display?: number, target: "law" | "eflaw" = "law", nw?: "1" | "2" | "3"): Promise<string> {
    // 공백 연속을 먼저 하나로 뭉친다. normalizeLawSearchText(LexDiff 원본, 수정 금지)의 정규식이
    // 공백 연속에 O(k²) 로 백트래킹해 10만 자 공백이면 15초가 걸렸다(2026-09-23 리뷰 C3).
    // 30만 건 차등 퍼징에서 출력 차이 0건.
    const normalizedQuery = normalizeLawSearchText(query.replace(/\s+/gu, " "))
    const aliasResolution = resolveLawAlias(normalizedQuery)
    const finalQuery = aliasResolution.canonical

    const params = new URLSearchParams({
      OC: this.getApiKey(apiKey),
      type: this.getResponseType(),
      target,
      query: finalQuery,
    })
    if (display && display > 0) params.append("display", String(display))
    if (nw) params.append("nw", nw)

    const url = `${LAW_API_BASE}/lawSearch.do?${params.toString()}`
    const response = await fetchWithRetry(url, DRF_RETRY)
    await this.throwIfError(response, "searchLaw")

    return await this.readBody(response, "법령 검색", "법령 검색 결과를 받지 못했습니다")
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
    // MST 단독(efYd 없음)은 target=law 로 바로 간다. 법제처가 2026-08-27부터 eflaw 단건에
    // efYd 를 요구해(#153) MST 단독 eflaw 는 매번 200 + HTML 안내 페이지로 실패하고, 재시도
    // 사다리가 그걸 점검 페이지로 보고 4회(백오프 약 2.1초) 두드린 뒤에야 target=law 폴백에
    // 닿았다. 결과는 폴백 본문 그대로라 비용만 컸다: get_law_text 1회에 업스트림 5회·약 3.3초
    // 추가, verify_citations 는 인용 10건이면 예산(48)이 바닥나 대부분 검증 실패(2026-09-23
    // 리뷰 A1·B1, 실측). MST 는 버전 고유값이라 target=law 가 그 버전 전문(부칙 포함)을 준다.
    // 같은 날 실측: eflaw 는 ID 단독은 정상(JSON), MST 단독만 HTML 이다 → lawId 경로는 그대로.
    //
    // efYd 를 지정한 요청은 target=law 로 보내지 않는다. MST 는 "공포본" 단위라 분리시행
    // 공포본이면 target=law 가 마지막 시행 슬라이스를 돌려준다(실측: MST 281865 → 시행
    // 20271231, 시행 중인 20260701 아님). 시행일을 못박은 호출에 다른 슬라이스를 끼워 넣으면
    // NOT_FOUND 보다 나쁜 조용한 오답(행위시법 조문 비교 오염)이 된다.
    const byMstOnly = Boolean(params.mst) && !params.efYd
    const target = byMstOnly ? "law" : "eflaw"
    const apiParams = new URLSearchParams({
      target,
      OC: this.getApiKey(params.apiKey),
      type: "JSON",
    })

    if (params.mst) apiParams.append("MST", String(params.mst))
    if (params.lawId && !byMstOnly) apiParams.append("ID", String(params.lawId))
    if (params.jo) apiParams.append("JO", String(params.jo))
    if (params.efYd) apiParams.append("efYd", String(params.efYd))

    const url = `${LAW_API_BASE}/lawService.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url, lookupRetryFor(target))
    await this.throwIfError(response, "getLawText")

    const notFoundContext = params.jo
      ? `법령 조문(${params.jo})을 찾을 수 없습니다. MST/lawId와 조문번호를 확인해주세요.`
      : "법령을 찾을 수 없습니다. MST 또는 법령명을 확인해주세요."
    // 빈 봉투("{}")는 그대로 돌려보내 상위 레이어가 NOT_FOUND 로 표면화한다
    return await this.readBody(response, "법령 조회", notFoundContext)
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
    const response = await fetchWithRetry(url, lookupRetryFor("oldAndNew"))
    await this.throwIfError(response, "compareOldNew")

    return await this.readBody(response, "신구법 대조")
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
    const response = await fetchWithRetry(url, lookupRetryFor("thdCmp"))
    await this.throwIfError(response, "getThreeTier")

    return await this.readBody(response, "3단비교")
  }

  /**
   * 행정규칙 검색
   */
  async searchAdminRule(params: {
    query: string
    knd?: string
    apiKey?: string
    nw?: string // 1=현행(기본), 2=연혁 — 폐지·개정 전 이력 포함
  }): Promise<string> {
    const apiParams = new URLSearchParams({
      OC: this.getApiKey(params.apiKey),
      type: this.getResponseType(),
      target: "admrul",
      query: params.query,
    })

    if (params.knd) apiParams.append("knd", params.knd)
    if (params.nw) apiParams.append("nw", params.nw)

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url, DRF_RETRY)
    await this.throwIfError(response, "searchAdminRule")

    return await this.readBody(response, "행정규칙 검색")
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
    const response = await fetchWithRetry(url, lookupRetryFor("admrul"))
    await this.throwIfError(response, "getAdminRule")

    return await this.readBody(response, "행정규칙 조회", "행정규칙을 찾을 수 없습니다. ID를 확인해주세요")
  }

  /**
   * 별표/서식 조회
   * LexDiff 방식: lawSearch.do + target=licbyl
   */
  async getAnnexes(params: {
    lawName: string
    knd?: "1" | "2" | "3" | "4" | "5"
    apiKey?: string
    /**
     * 1-based 페이지. display 를 100 초과로 올려도 업스트림이 100건에서 자르므로
     * (2026-08-17 실측: display=300 → numOfRows=100) 전 건은 page 로만 이어 받는다.
     */
    page?: number
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

    // 1페이지는 파라미터를 붙이지 않는다 — 기존 요청과 바이트 동일하게 유지
    if (params.page && params.page > 1) {
      apiParams.set("page", String(params.page))
    }

    const url = `${LAW_API_BASE}/lawSearch.do?${apiParams.toString()}`
    const response = await fetchWithRetry(url, DRF_RETRY)
    await this.throwIfError(response, "getAnnexes")

    // HTML 가드 필수 (#150): 없으면 HTML 이 parseAnnexEnvelope 의 JSON.parse catch 에서
    // 무음으로 빈 목록이 되고, 부존재 단정으로 둔갑한다.
    return await this.readBody(response, "별표·서식 검색", "별표·서식 검색 결과를 받지 못했습니다")
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
    const response = await fetchWithRetry(url, DRF_RETRY)
    await this.throwIfError(response, "searchOrdinance")

    return await this.readBody(response, "자치법규 검색")
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
    const response = await fetchWithRetry(url, lookupRetryFor("ordin"))
    await this.throwIfError(response, "getOrdinance")

    return await this.readBody(response, "자치법규 조회", "자치법규를 찾을 수 없습니다. ordinSeq를 확인해주세요")
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
    const response = await fetchWithRetry(url, DRF_RETRY)
    await this.throwIfError(response, "getArticleHistory")

    return await this.readBody(response, "조문 개정이력 조회")
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
    // 미스가 빈 본문으로 오는 단건 조회 target만 확인 1회로 끊는다(lookupRetryFor).
    // 그 위에, type=HTML(lsHistory 등)은 HTML 본문이 정상이므로 빈본문/HTML 재시도
    // 휴리스틱이 정상 응답마다 재시도를 소진(요청 4배 증폭)하지 않도록 허용 플래그를 겹쳐 붙인다.
    const base = params.endpoint === "lawService.do" ? lookupRetryFor(params.target) : DRF_RETRY
    const response = await fetchWithRetry(
      url,
      params.type === "HTML" ? { ...base, allowHtmlBody: true } : base
    )
    await this.throwIfError(response, `fetchApi(${params.target})`)

    // type=HTML 응답은 HTML 이 정상이라 가드를 끈다(null)
    return await this.readBody(
      response,
      `${params.target} 조회`,
      params.type === "HTML" ? null : "API 응답 오류 - 파라미터를 확인해주세요",
    )
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
    const response = await fetchWithRetry(url, DRF_RETRY)
    await this.throwIfError(response, "getLawHistory")

    return await this.readBody(response, "법령 변경이력 조회")
  }
}
