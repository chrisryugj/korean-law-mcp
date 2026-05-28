#!/usr/bin/env node

const assert = require("assert")
const net = require("net")

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return server.address().port
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function precedentDetailJson(id) {
  return JSON.stringify({
    PrecService: {
      사건명: `상세 판례 ${id}`,
      사건번호: `2024다${id}`,
      법원명: "대법원",
      선고일자: "20240101",
      사건종류명: "민사",
      판결유형: "판결",
      판시사항: `판시사항 ${id}`,
      판결요지: `판결요지 ${id}`,
      참조조문: "민법 제398조",
      판례내용: `전문 ${id}`,
    },
  })
}

function notFoundJson() {
  return JSON.stringify({
    Law: "일치하는 판례가 없습니다.  판례명을 확인하여 주십시오.",
  })
}

function htmlWrapper(id) {
  return [
    "<html>",
    "<body>",
    `<input type="hidden" id="precSeq" value ="${id}"/>`,
    `<iframe src = "http://www.law.go.kr/LSW/precInfoP.do?precSeq=${id}&mode=0"></iframe>`,
    "</body>",
    "</html>",
  ].join("")
}

function taxlawActionJson(ntstDcmId) {
  return JSON.stringify({
    status: "SUCCESS",
    message: null,
    data: {
      ASIQTB002PR01: {
        dcmDVO: {
          ntstDcmId,
          ntstDcmTtl: "매매 사실이 등기에 의하여 추정되는 이상 양도소득세 과세대상 판단은 적법함",
          ntstDcmDscmCntn: "인천지방법원-2025-구단-50403",
          ntstDcmGistCntn: "양도소득세 과세대상 판단은 적법함",
          ntstDcmRgtDt: "20260414",
        },
        dcmHwpEditorDVOList: [
          {
            dcmFleTy: "hwp",
            dcmFleByte: "",
          },
          {
            dcmFleTy: "html",
            dcmFleByte: [
              "<html><body>",
              "<table><tr><td>사 건</td><td>인천지방법원 2025구단50403</td></tr></table>",
              "<p>주 문</p>",
              "<p>1. 원고의 청구를 기각한다.</p>",
              "<p>이 유</p>",
              "<p>피고가 원고에게 한 양도소득세 부과처분은 적법하다.</p>",
              "</body></html>",
            ].join(""),
          },
        ],
      },
    },
  })
}

function response(text, url = "https://example.test/") {
  const res = new Response(text, { status: 200 })
  Object.defineProperty(res, "url", { value: url })
  return res
}

function redirectResponse(location, url = "https://www.law.go.kr/LSW/precInfoP.do") {
  const res = new Response("", {
    status: 302,
    headers: { location },
  })
  Object.defineProperty(res, "url", { value: url })
  return res
}

function makeApiClient(mode) {
  const requests = []
  return {
    requests,
    async fetchApi(request) {
      requests.push(request)
      const id = String(request.extraParams?.ID || "")
      assert.strictEqual(request.endpoint, "lawService.do")
      assert.strictEqual(request.target, "prec")

      if (mode === "json-ok") {
        assert.strictEqual(request.type, "JSON")
        return precedentDetailJson(id)
      }

      if (mode === "fallback-ok") {
        if (request.type === "JSON") return notFoundJson()
        if (request.type === "HTML") return htmlWrapper(id)
      }

      if (mode === "fallback-invalid-html") {
        if (request.type === "JSON") return notFoundJson()
        if (request.type === "HTML") return "<html><body>not a matching precedent page</body></html>"
      }

      if (mode === "fallback-after-json-parse-error") {
        if (request.type === "JSON") return "<html><body>not json</body></html>"
        if (request.type === "HTML") return htmlWrapper(id)
      }

      throw new Error(`unexpected mode/request: ${mode} ${JSON.stringify(request)}`)
    },
  }
}

async function testJsonPathDoesNotCallHtmlFallback(getPrecedentText) {
  const apiClient = makeApiClient("json-ok")
  const originalFetch = global.fetch
  global.fetch = async () => {
    throw new Error("global fetch should not be called for JSON precedent")
  }
  try {
    const result = await getPrecedentText(apiClient, { id: "111", apiKey: "test" })
    const text = result.content?.[0]?.text || ""

    assert.strictEqual(result.isError, undefined)
    assert.deepStrictEqual(apiClient.requests.map((r) => r.type), ["JSON"])
    assert.ok(text.includes("상세 판례 111"), text)
    assert.ok(text.includes("전문 111"), text)
  } finally {
    global.fetch = originalFetch
  }
}

async function testHtmlFallbackExtractsTaxlawBody(getPrecedentText) {
  const apiClient = makeApiClient("fallback-ok")
  const fetchCalls = []
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    const urlString = String(url)
    fetchCalls.push({ url: urlString, options })

    if (urlString === "http://www.law.go.kr/LSW/precInfoP.do?precSeq=777&mode=0") {
      assert.strictEqual(options.redirect, "manual")
      return redirectResponse("https://www.law.go.kr/LSW/precInfoP.do?precSeq=777&mode=0", urlString)
    }

    if (urlString === "https://www.law.go.kr/LSW/precInfoP.do?precSeq=777&mode=0") {
      assert.strictEqual(options.redirect, "manual")
      return redirectResponse("https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=200000000000020476", urlString)
    }

    if (urlString === "https://taxlaw.nts.go.kr/action.do") {
      assert.strictEqual(options.method, "POST")
      assert.ok(String(options.body).includes("ASIQTB002PR01"), String(options.body))
      assert.ok(String(options.body).includes("200000000000020476"), String(options.body))
      return response(taxlawActionJson("200000000000020476"), urlString)
    }

    throw new Error(`unexpected fetch: ${urlString}`)
  }

  try {
    const result = await getPrecedentText(apiClient, { id: "777", apiKey: "test" })
    const text = result.content?.[0]?.text || ""

    assert.strictEqual(result.isError, undefined, text)
    assert.deepStrictEqual(apiClient.requests.map((r) => r.type), ["JSON", "HTML"])
    assert.strictEqual(fetchCalls.length, 3)
    assert.ok(!fetchCalls.some((call) => call.url.includes("/qt/USEQTA002P.do")), JSON.stringify(fetchCalls))
    assert.ok(text.includes("매매 사실이 등기에 의하여 추정되는 이상 양도소득세"), text)
    assert.ok(text.includes("전문:"), text)
    assert.ok(text.includes("양도소득세 부과처분은 적법하다"), text)
    assert.ok(!text.includes("<html"), text)
    assert.ok(!text.includes("<iframe"), text)
    assert.ok(!text.includes("dcmFleByte"), text)
    assert.ok(!text.includes("action.do"), text)
  } finally {
    global.fetch = originalFetch
  }
}

async function testHtmlFallbackUsesExternalProxyConfigForTaxlawAction(getPrecedentText) {
  const apiClient = makeApiClient("fallback-ok")
  const originalFetch = global.fetch
  const originalProxy = process.env.LAW_EXTERNAL_HTTPS_PROXY

  process.env.LAW_EXTERNAL_HTTPS_PROXY = "https://proxy.example.test:8080"
  global.fetch = async (url, options = {}) => {
    const urlString = String(url)

    if (urlString === "http://www.law.go.kr/LSW/precInfoP.do?precSeq=779&mode=0") {
      assert.strictEqual(options.redirect, "manual")
      return redirectResponse("https://www.law.go.kr/LSW/precInfoP.do?precSeq=779&mode=0", urlString)
    }

    if (urlString === "https://www.law.go.kr/LSW/precInfoP.do?precSeq=779&mode=0") {
      assert.strictEqual(options.redirect, "manual")
      return redirectResponse("https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=200000000000020476", urlString)
    }

    throw new Error(`unexpected fetch: ${urlString} ${JSON.stringify(options)}`)
  }

  try {
    const result = await getPrecedentText(apiClient, { id: "779", apiKey: "test" })
    const text = result.content?.[0]?.text || ""

    assert.strictEqual(result.isError, true)
    assert.ok(text.includes("LAW_EXTERNAL_HTTPS_PROXY must be an http:// proxy URL"), text)
  } finally {
    global.fetch = originalFetch
    if (originalProxy === undefined) delete process.env.LAW_EXTERNAL_HTTPS_PROXY
    else process.env.LAW_EXTERNAL_HTTPS_PROXY = originalProxy
  }
}

async function testHtmlFallbackUsesExternalProxyForHttpsRedirectResolution(getPrecedentText) {
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n")
    })
  })
  const port = await listen(server)
  const apiClient = makeApiClient("fallback-ok")
  const originalFetch = global.fetch
  const originalProxy = process.env.LAW_EXTERNAL_HTTPS_PROXY
  const originalTls = process.env.LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED

  process.env.LAW_EXTERNAL_HTTPS_PROXY = `http://127.0.0.1:${port}`
  process.env.LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED = "0"
  global.fetch = async (url, options = {}) => {
    const urlString = String(url)

    if (urlString === "http://www.law.go.kr/LSW/precInfoP.do?precSeq=780&mode=0") {
      assert.strictEqual(options.redirect, "manual")
      return redirectResponse("https://www.law.go.kr/LSW/precInfoP.do?precSeq=780&mode=0", urlString)
    }

    throw new Error(`unexpected direct fetch: ${urlString} ${JSON.stringify(options)}`)
  }

  try {
    const result = await getPrecedentText(apiClient, { id: "780", apiKey: "test" })
    const text = result.content?.[0]?.text || ""

    assert.strictEqual(result.isError, true)
    assert.ok(text.includes("External HTTPS proxy CONNECT failed with HTTP 407"), text)
  } finally {
    global.fetch = originalFetch
    if (originalProxy === undefined) delete process.env.LAW_EXTERNAL_HTTPS_PROXY
    else process.env.LAW_EXTERNAL_HTTPS_PROXY = originalProxy
    if (originalTls === undefined) delete process.env.LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED
    else process.env.LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED = originalTls
    await close(server)
  }
}

async function testHtmlFallbackRejectsIframeWithoutTaxlawLocation(getPrecedentText) {
  const apiClient = makeApiClient("fallback-ok")
  const originalFetch = global.fetch

  global.fetch = async (url, options = {}) => {
    const urlString = String(url)

    if (urlString.includes("/LSW/precInfoP.do?precSeq=778&mode=0")) {
      assert.strictEqual(options.redirect, "manual")
      return redirectResponse("https://taxlaw.nts.go.kr/qt/USEQTA002P.do")
    }

    throw new Error(`unexpected fetch: ${urlString} ${JSON.stringify(options)}`)
  }

  try {
    const result = await getPrecedentText(apiClient, { id: "778", apiKey: "test" })
    const text = result.content?.[0]?.text || ""

    assert.strictEqual(result.isError, true)
    assert.ok(text.includes("HTML fallback response did not expose ntstDcmId"), text)
  } finally {
    global.fetch = originalFetch
  }
}

async function testHtmlFallbackRejectsUnmatchedHtml(getPrecedentText) {
  const apiClient = makeApiClient("fallback-invalid-html")
  const originalFetch = global.fetch
  global.fetch = async () => {
    throw new Error("global fetch should not be called without matching iframe")
  }
  try {
    const result = await getPrecedentText(apiClient, { id: "999", apiKey: "test" })
    const text = result.content?.[0]?.text || ""

    assert.strictEqual(result.isError, true)
    assert.deepStrictEqual(apiClient.requests.map((r) => r.type), ["JSON", "HTML"])
    assert.ok(text.includes("get_precedent_text"), text)
  } finally {
    global.fetch = originalFetch
  }
}

async function testHtmlFallbackRunsAfterJsonParseError(getPrecedentText) {
  const apiClient = makeApiClient("fallback-after-json-parse-error")
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    const urlString = String(url)
    if (urlString === "http://www.law.go.kr/LSW/precInfoP.do?precSeq=888&mode=0") {
      assert.strictEqual(options.redirect, "manual")
      return redirectResponse("https://www.law.go.kr/LSW/precInfoP.do?precSeq=888&mode=0", urlString)
    }

    if (urlString === "https://www.law.go.kr/LSW/precInfoP.do?precSeq=888&mode=0") {
      assert.strictEqual(options.redirect, "manual")
      return redirectResponse("https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=200000000000020476", urlString)
    }
    if (urlString === "https://taxlaw.nts.go.kr/action.do") {
      return response(taxlawActionJson("200000000000020476"), urlString)
    }
    throw new Error(`unexpected fetch: ${urlString} ${JSON.stringify(options)}`)
  }
  try {
    const result = await getPrecedentText(apiClient, { id: "888", apiKey: "test" })
    const text = result.content?.[0]?.text || ""

    assert.strictEqual(result.isError, undefined, text)
    assert.deepStrictEqual(apiClient.requests.map((r) => r.type), ["JSON", "HTML"])
    assert.ok(text.includes("양도소득세 부과처분은 적법하다"), text)
  } finally {
    global.fetch = originalFetch
  }
}

async function main() {
  const { getPrecedentText } = await import("../build/tools/precedents.js")
  await testJsonPathDoesNotCallHtmlFallback(getPrecedentText)
  await testHtmlFallbackExtractsTaxlawBody(getPrecedentText)
  await testHtmlFallbackUsesExternalProxyConfigForTaxlawAction(getPrecedentText)
  await testHtmlFallbackUsesExternalProxyForHttpsRedirectResolution(getPrecedentText)
  await testHtmlFallbackRejectsIframeWithoutTaxlawLocation(getPrecedentText)
  await testHtmlFallbackRejectsUnmatchedHtml(getPrecedentText)
  await testHtmlFallbackRunsAfterJsonParseError(getPrecedentText)
  console.log("precedent html fallback tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
