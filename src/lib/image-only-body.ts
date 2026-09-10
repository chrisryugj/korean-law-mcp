/**
 * 이미지-only 본문 판정 (#159).
 *
 * 법제처 API는 별표의 기준 수치·대상 목록을 `<img id="...">` 태그로만 돌려줄 때가 있다
 * (예: 유역환경청 별도배출허용기준 고시). 텍스트가 사실상 없는데 응답은 정상으로 보여
 * LLM 이 수치를 지어내기 딱 좋은 자리다 — 이 서버의 환각 방지 목표와 정면으로 부딪힌다.
 *
 * 태그를 걷어낸 실텍스트 길이로 "본문이 비어 있음"을 판정한다.
 */

/** `<img ...>` · `<img ...></img>` 양쪽 표기 (법제처는 둘을 섞어 쓴다) */
const IMG_TAG = /<img\b[^>]*>(?:\s*<\/img\s*>)?/gi

/**
 * 실텍스트 하한. 이보다 짧으면 본문이 아니라 이미지 캡션 수준이다
 * (실측: 낙동강유역환경청 고시 2100000248042 = 이미지 6개 + 실텍스트 8자 "(단위:㎎/ℓ)").
 * 조문 한 개도 못 되는 길이라 여유를 크게 잡아도 정상 본문을 오판하지 않는다.
 */
const MIN_REAL_TEXT = 100

export interface ImageOnlyBody {
  imageCount: number
  /** 공백·이미지 태그를 뺀 실텍스트 길이 */
  textLength: number
  /** 이미지가 있고 실텍스트가 하한 미만 — 본문이 사실상 비어 있음 */
  imageOnly: boolean
}

export function analyzeImageOnlyBody(text: string): ImageOnlyBody {
  const imageCount = text.match(IMG_TAG)?.length ?? 0
  const textLength = text.replace(IMG_TAG, "").replace(/\s+/g, "").length
  return { imageCount, textLength, imageOnly: imageCount > 0 && textLength < MIN_REAL_TEXT }
}

/** 법제처 행정규칙 본문 뷰어 — 이미지 별표를 사람이 눈으로 확인하는 자리 */
export function adminRuleSourceUrl(seq: string): string {
  return `https://www.law.go.kr/admRulInfoP.do?admRulSeq=${encodeURIComponent(seq)}`
}

/**
 * 이미지-only 경고문.
 * 첨부파일(원문 hwpx/pdf)이 있으면 함께 안내한다 — 심사원이 실제로 확인하는 수치가
 * 그 파일 안에 있는데, 종전에는 조문내용이 "비어 있지 않다"는 이유로 링크까지 묻혔다.
 */
export function buildImageOnlyWarning(
  seq: string,
  info: ImageOnlyBody,
  attachments: Array<{ name: string; link: string }> = [],
): string {
  let out = `⚠️ 별표·수치가 이미지로만 제공되어 텍스트 추출 불가 (이미지 ${info.imageCount}개, 추출된 텍스트 ${info.textLength}자)\n`
  out += `   → 기준 수치·적용 대상 목록은 아래 원문에서 직접 확인하세요.\n`
  out += `   원문: ${adminRuleSourceUrl(seq)}\n`
  for (const a of attachments) {
    out += `   원문 파일: ${a.name} — ${a.link}\n`
  }
  out += `⚠️ LLM은 이미지 안의 수치·대상 목록을 추측/생성하지 마세요.\n`
  return out
}
