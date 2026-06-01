#!/usr/bin/env node

/**
 * 법제처 빈/HTML 응답 자동 재시도 회귀 테스트 (v4.0.8)
 *
 * 법제처 OPEN API가 200에 빈 본문 또는 HTML 점검 페이지를 반환할 때
 * fetchWithRetry가 일시 장애로 간주해 재시도하는지 검증한다.
 * (미처리 시 XML 파서가 "missing root element"로 터짐)
 */

const assert = require("assert")
const http = require("http")
const { pathToFileURL } = require("url")
const path = require("path")

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return server.address().port
}

async function main() {
  const mod = await import(
    pathToFileURL(path.resolve(__dirname, "../build/lib/fetch-with-retry.js")).href
  )
  const { fetchWithRetry } = mod

  const hits = { empty: 0, html: 0, recover: 0 }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x")
    const mode = u.searchParams.get("mode")
    res.statusCode = 200
    if (mode === "empty") { hits.empty++; res.end("") }
    else if (mode === "html") {
      hits.html++
      res.end("<!DOCTYPE html><html><head><link></head><body>점검중</body></html>")
    } else if (mode === "recover") {
      hits.recover++
      // 빈 응답 2회 후 정상 XML — 간헐 장애가 재시도로 복구되는지
      if (hits.recover < 3) res.end("")
      else res.end("<?xml version='1.0'?><LawSearch><law><법령명한글>민법</법령명한글></law></LawSearch>")
    } else {
      res.end("<?xml version='1.0'?><ok/>")
    }
  })

  const port = await listen(server)
  const base = `http://127.0.0.1:${port}`
  const opt = { retryDelay: 10, timeout: 2000 } // retries 기본 3 → 총 4회 시도

  try {
    // 1. 빈 응답: 4회 시도(1+3) 후 빈 응답 반환 (api-client가 명확한 에러로 전환)
    const r1 = await fetchWithRetry(`${base}/?mode=empty`, opt)
    await r1.text()
    assert.strictEqual(hits.empty, 4, `빈 응답 재시도 횟수: 기대 4, 실제 ${hits.empty}`)

    // 2. HTML 응답: 4회 재시도
    const r2 = await fetchWithRetry(`${base}/?mode=html`, opt)
    await r2.text()
    assert.strictEqual(hits.html, 4, `HTML 응답 재시도 횟수: 기대 4, 실제 ${hits.html}`)

    // 3. 간헐 장애 복구: 빈 2회 → 3회째 정상 XML
    const r3 = await fetchWithRetry(`${base}/?mode=recover`, opt)
    const t3 = await r3.text()
    assert.ok(t3.includes("민법"), "간헐 장애가 재시도로 복구되어야 함")
    assert.strictEqual(hits.recover, 3, `복구 시도 횟수: 기대 3, 실제 ${hits.recover}`)

    // 4. 정상 응답은 재시도/지연 없이 즉시 반환
    const r4 = await fetchWithRetry(`${base}/?mode=ok`, opt)
    const t4 = await r4.text()
    assert.ok(t4.includes("<ok"), "정상 XML은 그대로 반환되어야 함")

    console.log("✓ 빈 응답 재시도 (4회)")
    console.log("✓ HTML 응답 재시도 (4회)")
    console.log("✓ 간헐 장애 재시도 복구 (3회째 정상)")
    console.log("✓ 정상 응답 즉시 반환")
    console.log("\nPASS: test-empty-html-retry")
  } finally {
    server.close()
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message)
  process.exit(1)
})
