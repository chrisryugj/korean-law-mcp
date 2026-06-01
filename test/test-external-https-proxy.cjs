#!/usr/bin/env node

const assert = require("assert")
const net = require("net")

async function withEnv(values, fn) {
  const previous = {}
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key]
    if (values[key] === undefined) delete process.env[key]
    else process.env[key] = values[key]
  }

  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

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

async function testProxyConfigDefaults(proxy) {
  await withEnv({
    LAW_EXTERNAL_HTTPS_PROXY: undefined,
    LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED: undefined,
  }, async () => {
    assert.strictEqual(proxy.getExternalHttpsProxyConfig(), null)
  })
}

async function testProxyConfigParsesHttpProxy(proxy) {
  await withEnv({
    LAW_EXTERNAL_HTTPS_PROXY: "http://proxy.example.test:8080",
    LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED: undefined,
  }, async () => {
    const config = proxy.getExternalHttpsProxyConfig()
    assert.strictEqual(config.host, "proxy.example.test")
    assert.strictEqual(config.port, 8080)
    assert.strictEqual(config.rejectUnauthorized, true)
  })
}

async function testProxyConfigParsesScopedTlsOverride(proxy) {
  await withEnv({
    LAW_EXTERNAL_HTTPS_PROXY: "http://proxy.example.test:8080",
    LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED: "0",
  }, async () => {
    const config = proxy.getExternalHttpsProxyConfig()
    assert.strictEqual(config.rejectUnauthorized, false)
  })
}

async function testProxyConfigRejectsInvalidProtocol(proxy) {
  await withEnv({
    LAW_EXTERNAL_HTTPS_PROXY: "https://proxy.example.test:8080",
  }, async () => {
    assert.throws(
      () => proxy.getExternalHttpsProxyConfig(),
      /LAW_EXTERNAL_HTTPS_PROXY must be an http:\/\/ proxy URL/
    )
  })
}

async function testProxyConnectFailureIncludesStatus(proxy) {
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n")
    })
  })
  const port = await listen(server)

  try {
    await withEnv({
      LAW_EXTERNAL_HTTPS_PROXY: `http://127.0.0.1:${port}`,
    }, async () => {
      await assert.rejects(
        () => proxy.requestExternalHttps("https://taxlaw.nts.go.kr/action.do", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "actionId=ASIQTB002PR01",
          timeout: 1000,
        }),
        /External HTTPS proxy CONNECT failed with HTTP 407/
      )
    })
  } finally {
    await close(server)
  }
}

async function main() {
  const proxy = await import("../build/lib/external-https-proxy.js")

  await testProxyConfigDefaults(proxy)
  await testProxyConfigParsesHttpProxy(proxy)
  await testProxyConfigParsesScopedTlsOverride(proxy)
  await testProxyConfigRejectsInvalidProtocol(proxy)
  await testProxyConnectFailureIncludesStatus(proxy)

  console.log("external https proxy tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
