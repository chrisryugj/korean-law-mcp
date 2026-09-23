/**
 * 법제처 DRF가 "그 레코드는 없다"를 표현하는 방식.
 *
 * DRF는 실패도 전부 HTTP 200으로 답하고, 미스 본문의 형태는 target×type 조합이
 * 결정한다 (2026-08-16 34조합 전수 실측 — _workspace/04_qa_verification.md §3.2).
 *
 *   - 단건 조회 대다수: 정상 XML/JSON 봉투 + "일치하는 …없습니다" → 걸러낼 것 없음
 *   - `prec`/`thdCmp`/`lsStmd` + JSON: 200 + **0바이트**
 *   - `lsStmd` + XML: 200 + 권한 안내 HTML (문안이 OC 키의 API 신청 상태에 의존하므로
 *     문구 매칭으로 분류해서는 안 된다)
 *   - 검색(`lawSearch.do`)은 18/18 전부 정상 봉투 — 빈 본문/HTML이 오면 그건 진짜 장애다
 *
 * 그래서 "빈 본문 = 미스일 수 있다"는 읽기는 **단건 조회 경로에서만** 참이다.
 * 그마저도 본문만으로는 미스와 점검·과부하를 구별할 수 없으므로, 호출부가
 * `singleRecordLookup`을 켠 경로에서만 짧은 확인 재시도 1회를 거쳐 미스로 확정한다.
 */

import { ExecutionLimitError } from "./execution-limits.js"
import { readBodyPrefix, UpstreamBodyStallError } from "./response-body.js"
import { getRequestSignal } from "./session-state.js"
import { isBlankBody, isHtmlPage } from "./body-shape.js"

export type BadBodyKind = "empty" | "html"

/**
 * 법제처 API가 200으로 빈 본문/HTML(점검·과부하 페이지, 권한 안내 페이지)을 반환한
 * 경우를 감지. 정상 응답은 XML(`<`) 또는 JSON(`{`/`[`)으로 시작한다.
 * 술어 자체는 `body-shape.ts` 하나에서만 정의한다 — 여기서는 의미만 붙인다.
 */
/** 테스트 도달용 공개 — 프로덕션 소비자는 이 파일 안뿐이다 (#143) */
export function detectBadBody(text: string): BadBodyKind | null {
  if (isBlankBody(text)) return "empty"
  if (isHtmlPage(text)) return "html"
  return null
}

/**
 * 판정에 필요한 만큼만 훔쳐본다. 빈 본문이냐 HTML이냐는 첫 몇 바이트에서 갈리므로
 * 본문 전체를 복제해 읽을 이유가 없다 — 1 MB 넘는 법령 전문을 두 번 받아 예산에
 * 두 번 청구하던 문제(#115와 같은 뿌리)를 여기서 끊는다.
 */
const PROBE_BYTES = 1024

/**
 * 200 응답의 앞부분을 (취소를 지키며) 훔쳐봐 미스/장애 표시인지 판정한다.
 * 본문을 읽지 못하면(clone 실패 등) 정상 응답으로 보고 `null`을 돌려주고,
 * 취소·예산 초과는 호출부가 요청을 중단하도록 그대로 던진다.
 */
export async function classifyOkBody(
  response: Response,
  externalSignal?: AbortSignal,
): Promise<BadBodyKind | null> {
  const inspection = response.clone()
  try {
    const { text, complete } = await readBodyPrefix(inspection, PROBE_BYTES)
    const bad = detectBadBody(text)
    // 프로브 구간이 전부 공백인데 본문이 더 남아 있다면 "빈 본문"이라 단정할 수 없다.
    return bad === "empty" && !complete ? null : bad
  } catch (error) {
    // 본문이 멈춘 응답은 원본을 읽어도 같은 자리에서 멈춘다. 정상으로 넘기지 말고 던져서
    // fetchWithRetry 가 다음 시도로 가게 한다(2026-09-23 리뷰 A5).
    if (error instanceof ExecutionLimitError || error instanceof UpstreamBodyStallError || getRequestSignal()?.aborted || externalSignal?.aborted) {
      // 요청 자체가 끝난다 — 아무도 원본을 읽지 않으므로 여기서 같이 버려야 소켓이 돈다.
      void response.body?.cancel().catch(() => {})
      throw error
    }
    return null
  } finally {
    // 훔쳐본 가지는 언제나 버린다. await 금지 — tee 한쪽만 취소하면 settle되지 않는다(#115).
    void inspection.body?.cancel().catch(() => {})
  }
}

/** 미스 확인 재시도 간격 — 업스트림 p50 왕복(0.4~1.1초)보다 짧게 잡아 한 번만 되묻는다. */
export const MISS_CONFIRM_DELAY_MS = 200

/**
 * 단건 조회가 확인 재시도 후에도 빈 본문/안내 페이지만 돌려준 경우.
 * 빈 결과를 정상 응답으로 흘려보내지 않기 위해 명시적으로 던진다.
 *
 * 문안 원칙(legal-expert 검토, _workspace/13_legal_wording_review.md): 이 오류는
 * **업스트림이 자료를 주지 않았다는 관측**일 뿐 자료의 부존재를 증명하지 않는다.
 * 확인 재시도가 200ms 1회라는 사실까지 밝혀 유보를 검증 가능한 한정 진술로 만든다 —
 * 수 분짜리 점검은 200ms 뒤에도 똑같이 비어 있으므로 이 재확인의 증거력은 약하다.
 * "찾을 수 없습니다"로 후퇴시키지 말 것(부존재 함의가 붙는다).
 */
export class UpstreamRecordMissingError extends Error {
  /**
   * 어떤 모양으로 비었는지. 표면 문안이 원인 후보를 좁히는 근거다 — 이 모듈은
   * 안내 페이지(권한 미신청 등)를 빈 본문과 구별해 알고 있는데, 표면에서 두 원인으로
   * 눌러 버리면 "잠시 후 재시도"만 안내하게 되고 그 경우는 영원히 낫지 않는다(#146).
   */
  readonly kind: BadBodyKind

  /** @param maskedUrl 이미 `maskSensitiveUrl()`을 통과한 URL (API 키 유출 방지) */
  constructor(maskedUrl: string, kind: BadBodyKind) {
    super(
      `법제처 API가 요청한 자료를 반환하지 않았습니다` +
      `(${kind === "empty" ? "빈 본문" : "안내 페이지"} · ${MISS_CONFIRM_DELAY_MS}ms 간격 1회 재확인 후에도 동일). ` +
      `${kind === "empty"
        ? "자료가 실제로 없는 경우와 법제처 점검·과부하로 본문이 비는 경우는 이 응답만으로 구별되지 않습니다"
        : "자료 부존재, 법제처 점검·과부하, 이 인증키(OC)의 해당 API 미신청이 모두 같은 모양으로 옵니다"} ` +
      `— 어느 쪽인지 확정하지 마세요. - ${maskedUrl}`
    )
    this.name = "UpstreamRecordMissingError"
    this.kind = kind
  }
}
