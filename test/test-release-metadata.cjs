#!/usr/bin/env node

const assert = require("assert")
const { readFileSync } = require("fs")

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function main() {
  const packageJson = readJson("package.json")
  const packageLock = readJson("package-lock.json")
  const plugin = readJson(".claude-plugin/plugin.json")
  const marketplace = readJson(".claude-plugin/marketplace.json")
  const version = packageJson.version
  const expectedPin = `korean-law-mcp@${version}`

  assert.strictEqual(packageLock.version, version)
  assert.strictEqual(packageLock.packages[""].version, version)
  assert.strictEqual(plugin.version, version)
  assert.strictEqual(marketplace.plugins[0].version, version)
  assert.strictEqual(plugin.mcpServers["korean-law"].args.includes(expectedPin), true)
  assert.strictEqual(packageJson.files.includes("skills"), true)
  assert.strictEqual(packageJson.files.includes("docs/ON-DEMAND.md"), true)

  for (const path of [
    "README.md",
    "README-EN.md",
    "skills/korean-law/SKILL.md",
    "docs/ON-DEMAND.md",
  ]) {
    const content = readFileSync(path, "utf8")
    assert.strictEqual(content.includes(expectedPin), true, path)
    assert.strictEqual(content.includes("skills@1.5.20"), false, path)
  }

  process.stdout.write("release metadata tests passed\n")
}

main()
