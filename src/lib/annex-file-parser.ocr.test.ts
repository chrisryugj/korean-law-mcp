import { describe, expect, it, vi } from "vitest"

// kordoc 4.17 부터 OCR 모델이 캐시에 있으면 PDF 를 자동 OCR 한다(옵션 미지정 기본값). 모델이 깔린 환경에서만
// 파일당 0.4~7.4초·메모리 2배로 바뀌고, 신뢰도 낮은 인식문이 이미지 표식을 덮어썼다(2026-10-01 감사, 코퍼스 273건).
// 환경마다 결과가 갈리지 않게 끈다.
const seen: unknown[] = []
vi.mock("kordoc", () => ({
  parse: async (_buf: ArrayBuffer, opts?: unknown) => { seen.push(opts); return { success: true, fileType: "pdf", markdown: "본문" } },
}))

import { parseAnnexFile } from "./annex-file-parser.js"

describe("parseAnnexFile — 자동 OCR 끔", () => {
  it("kordoc 에 ocr:false 를 넘긴다", async () => {
    await parseAnnexFile(new ArrayBuffer(8))
    expect(seen.at(-1)).toMatchObject({ ocr: false })
  })
})
