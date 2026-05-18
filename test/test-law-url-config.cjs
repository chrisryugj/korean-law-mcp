#!/usr/bin/env node

const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { pathToFileURL } = require("url")
const { spawnSync } = require("child_process")

async function main() {
  const { getLawApiBaseUrl, getLawApiProtocol, getLawSiteBaseUrl } = await import("../build/lib/law-url-config.js")

  const previous = process.env.LAW_API_PROTOCOL
  try {
    delete process.env.LAW_API_PROTOCOL
    assert.strictEqual(getLawApiProtocol(), "https")
    assert.strictEqual(getLawApiBaseUrl(), "https://www.law.go.kr/DRF")
    assert.strictEqual(getLawSiteBaseUrl(), "https://www.law.go.kr")

    process.env.LAW_API_PROTOCOL = "http"
    assert.strictEqual(getLawApiProtocol(), "http")
    assert.strictEqual(getLawApiBaseUrl(), "http://www.law.go.kr/DRF")
    assert.strictEqual(getLawSiteBaseUrl(), "http://www.law.go.kr")

    process.env.LAW_API_PROTOCOL = "https"
    assert.strictEqual(getLawApiProtocol(), "https")
    assert.strictEqual(getLawApiBaseUrl(), "https://www.law.go.kr/DRF")

    process.env.LAW_API_PROTOCOL = "invalid"
    assert.strictEqual(getLawApiProtocol(), "https")
  } finally {
    if (previous === undefined) delete process.env.LAW_API_PROTOCOL
    else process.env.LAW_API_PROTOCOL = previous
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "korean-law-env-"))
  fs.writeFileSync(path.join(tempDir, ".env"), "LAW_API_PROTOCOL=http\n", "utf8")
  const moduleUrl = pathToFileURL(path.resolve(__dirname, "../build/lib/law-url-config.js")).href
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(moduleUrl)}); console.log(m.getLawApiBaseUrl());`,
    ],
    {
      cwd: tempDir,
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key !== "LAW_API_PROTOCOL")
      ),
    }
  )
  assert.strictEqual(child.status, 0, child.stderr)
  assert.strictEqual(child.stdout.trim(), "http://www.law.go.kr/DRF")

  console.log("law URL protocol config tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
