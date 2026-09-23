/**
 * 별표 파일 파서 — kordoc 위임
 *
 * HWPX/HWP5/PDF 모두 kordoc 통합 파서에 위임.
 * kordoc은 colAddr/rowAddr 기반 HWP5 셀 배치, PDF 라인+클러스터 이중 테이블 감지,
 * ZIP bomb 방지, 깨진 ZIP 복구 등 강화된 파싱 기능을 제공.
 *
 * @see https://github.com/chrisryugj/kordoc
 */

// kordoc 은 별표 파일을 실제로 파싱할 때만 불러온다. 정적 import 면 기동 즉시 RSS 가
// 27MB 늘어난다(로컬 실측). 5종이 1GB 를 나눠 쓰는 통합 호스트에선 큰 몫이다.
import type { ParseResult, FileType } from "kordoc"

// ─── 기존 인터페이스 호환 ────────────────────────────

export interface AnnexParseResult {
  success: boolean
  markdown?: string
  fileType: FileType
  /** 이미지 기반 PDF 여부 (텍스트 추출 불가) */
  isImageBased?: boolean
  /** PDF 페이지 수 */
  pageCount?: number
  error?: string
}

// ─── 메인 엔트리 ─────────────────────────────────────

export async function parseAnnexFile(buffer: ArrayBuffer): Promise<AnnexParseResult> {
  const { parse } = await import("kordoc")
  const result: ParseResult = await parse(buffer)

  if (result.success) {
    return {
      success: true,
      fileType: result.fileType,
      markdown: result.markdown,
    }
  }

  return {
    success: false,
    fileType: result.fileType,
    isImageBased: result.isImageBased,
    pageCount: result.pageCount,
    error: result.error,
  }
}

// ─── 본문 미추출 판정 (#91) ───────────────────────────

/**
 * 법제처가 별표 내용을 HWP에 인라인하지 않고 다운로드 아이콘으로만 임베드한 경우
 * 파서는 success를 주지만 실제 내용은 없다(관세법 별표 관세율표 등).
 *
 * 호출자 입장에서 이런 응답은 "내용이 짧은 별표"와 구별되지 않아, 관세율표처럼
 * 실질이 통째로 빠진 결과를 근거 삼아 답변이 구성된다. 그래서 명시적으로 가려낸다.
 *
 * 판정은 두 조건을 모두 요구한다 — 법제처 안내 문구가 있을 것, 그리고 안내문·링크를
 * 걷어낸 나머지가 사실상 제목뿐일 것. 한쪽만으로는 오탐이 난다: 안내문 없이 짧은
 * 별표(여권법 수수료표)는 정상이고, 안내문이 있어도 본문이 함께 실린 별표가 있다.
 */
const DOWNLOAD_NOTICE = /자세한\s*내용은[\s\S]{0,120}?(?:다운로드|주소창)/
// 치환용 전역 사본 — 안내문이 두 번 실리면 non-global 치환은 두 번째를 "실질 내용"으로
// 남겨 판정을 뒤집는다 (#150). 판정(test)은 non-global 원본을 유지한다: 전역 regex를
// test()에 쓰면 lastIndex가 남아 호출마다 답이 달라진다.
const DOWNLOAD_NOTICE_ALL = new RegExp(DOWNLOAD_NOTICE.source, "g")
const SUBSTANTIVE_MIN_CHARS = 150

export function isDownloadNoticeOnly(markdown: string): boolean {
  if (!DOWNLOAD_NOTICE.test(markdown)) return false

  const substantive = markdown
    .replace(DOWNLOAD_NOTICE_ALL, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")   // 이미지
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")    // 링크
    .replace(/https?:\/\/\S+/g, " ")         // 맨 URL
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")     // 잔여 태그(<u> 등)
    .replace(/[■\[\]\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return substantive.length < SUBSTANTIVE_MIN_CHARS
}
