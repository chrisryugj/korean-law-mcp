#!/usr/bin/env node

const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")

async function testPlatformPaths(credential) {
  assert.strictEqual(
    credential.getLawCredentialPath({
      env: {},
      homeDir: "/users/test",
      os: "darwin",
    }),
    path.resolve("/users/test/Library/Application Support/korean-law/config.json")
  )
  assert.strictEqual(
    credential.getLawCredentialPath({
      env: { XDG_CONFIG_HOME: "/xdg" },
      homeDir: "/users/test",
      os: "linux",
    }),
    path.resolve("/xdg/korean-law/config.json")
  )
  assert.strictEqual(
    credential.getLawCredentialPath({
      env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      homeDir: "C:\\Users\\test",
      os: "win32",
    }),
    path.resolve("C:\\Users\\test\\AppData\\Roaming", "korean-law/config.json")
  )
}

async function testCredentialLifecycle(credential) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "korean-law-credential-"))
  const configPath = path.join(tempDir, "nested", "config.json")

  try {
    await credential.saveLawApiKey("stored-key", configPath)
    assert.strictEqual(credential.readStoredLawApiKey(configPath), "stored-key")
    assert.strictEqual(
      credential.resolveLawApiKey({ env: {}, configPath }),
      "stored-key"
    )
    assert.strictEqual(
      credential.resolveLawApiKey({ env: { LAW_OC: "environment-key" }, configPath }),
      "environment-key"
    )
    assert.strictEqual(
      credential.resolveLawApiKey({
        env: { KOREAN_LAW_API_KEY: "alias-key" },
        configPath,
      }),
      "alias-key"
    )

    if (process.platform !== "win32") {
      assert.strictEqual(fs.statSync(configPath).mode & 0o777, 0o600)
    }
    assert.deepStrictEqual(
      fs.readdirSync(path.dirname(configPath)).filter((name) => name.endsWith(".tmp")),
      []
    )

    fs.writeFileSync(configPath, JSON.stringify({ lawOc: "" }), "utf8")
    assert.strictEqual(credential.readStoredLawApiKey(configPath), "")
    await assert.rejects(
      () => credential.saveLawApiKey("", configPath),
      /too_small|Too small/i
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function testUnsafeFilesAreRejected(credential, privateJson) {
  if (process.platform === "win32") return

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "korean-law-unsafe-"))
  const targetPath = path.join(tempDir, "target.json")
  const linkPath = path.join(tempDir, "config.json")

  try {
    fs.writeFileSync(targetPath, JSON.stringify({ untouched: true }), "utf8")
    fs.symlinkSync(targetPath, linkPath)
    assert.strictEqual(credential.readStoredLawApiKey(linkPath), "")
    await assert.rejects(
      () => privateJson.readPrivateJsonObject(linkPath),
      /Symlink config rejected|ELOOP/
    )
    await assert.rejects(
      () => credential.saveLawApiKey("must-not-write", linkPath),
      /Symlink config rejected/
    )
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(targetPath, "utf8")),
      { untouched: true }
    )

    fs.unlinkSync(linkPath)
    fs.writeFileSync(linkPath, Buffer.alloc(1024 * 1024 + 1))
    assert.strictEqual(credential.readStoredLawApiKey(linkPath), "")
    await assert.rejects(
      () => credential.saveLawApiKey("must-not-write", linkPath),
      /too large/
    )

    fs.unlinkSync(linkPath)
    const fifoResult = spawnSync("mkfifo", [linkPath], { encoding: "utf8" })
    assert.strictEqual(fifoResult.status, 0, fifoResult.stderr)
    assert.strictEqual(credential.readStoredLawApiKey(linkPath), "")
    await assert.rejects(
      () => privateJson.readPrivateJsonObject(linkPath),
      /not a regular file/
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  const credential = await import("../build/lib/law-credential.js")
  const privateJson = await import("../build/lib/private-json-file.js")
  await testPlatformPaths(credential)
  await testCredentialLifecycle(credential)
  await testUnsafeFilesAreRejected(credential, privateJson)
  process.stdout.write("law credential tests passed\n")
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
