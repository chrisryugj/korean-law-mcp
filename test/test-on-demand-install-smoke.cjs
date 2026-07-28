#!/usr/bin/env node

const assert = require("assert")
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs")
const { tmpdir } = require("os")
const { join } = require("path")
const { spawnSync } = require("child_process")

function main() {
  const userHome = mkdtempSync(join(tmpdir(), "korean-law-install-"))
  const placeholderKey = "ci-placeholder-not-a-secret"
  const result = spawnSync(
    process.execPath,
    ["build/index.js", "setup", "--mode", "on-demand"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: "\n",
      timeout: 120_000,
      env: {
        ...process.env,
        HOME: userHome,
        USERPROFILE: userHome,
        APPDATA: join(userHome, "AppData"),
        XDG_CONFIG_HOME: join(userHome, ".config"),
        LAW_OC: placeholderKey,
        KOREAN_LAW_API_KEY: "",
        NO_COLOR: "1",
      },
    }
  )
  const output = `${result.stdout || ""}${result.stderr || ""}`

  assert.strictEqual(result.status, 0, output)
  assert.strictEqual(output.includes(placeholderKey), false)
  for (const skillRoot of [".claude", ".agents"]) {
    const skillFile = join(userHome, skillRoot, "skills", "korean-law", "SKILL.md")
    assert.strictEqual(existsSync(skillFile), true, skillFile)
    assert.match(readFileSync(skillFile, "utf8"), /^---\s*\nname: korean-law$/m)
  }

  rmSync(userHome, { recursive: true, force: true })
  process.stdout.write("on-demand install smoke test passed\n")
}

main()
