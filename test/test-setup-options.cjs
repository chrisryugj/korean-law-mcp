#!/usr/bin/env node

const assert = require("assert")

async function main() {
  const setup = await import("../build/setup/setup-options.js")
  const onDemand = await import("../build/setup/on-demand.js")
  const setupWizard = await import("../build/setup.js")

  assert.deepStrictEqual(setup.parseSetupOptions([]), {
    mode: "mcp",
    skipSkillInstall: false,
    showHelp: false,
  })
  assert.deepStrictEqual(
    setup.parseSetupOptions(["--mode", "on-demand", "--skip-skill-install"]),
    {
      mode: "on-demand",
      skipSkillInstall: true,
      showHelp: false,
    }
  )
  assert.strictEqual(setup.parseSetupOptions(["--help"]).showHelp, true)
  assert.throws(
    () => setup.parseSetupOptions(["--mode", "invalid"]),
    /Invalid option/
  )
  assert.throws(
    () => setup.parseSetupOptions(["--skip-skill-install"]),
    /on-demand mode/
  )
  assert.throws(
    () => setup.parseSetupOptions(["--unknown"]),
    /Unknown setup option/
  )

  const linux = onDemand.buildSkillInstallInvocation("/tmp/korean-law", "linux")
  assert.strictEqual(linux.command.endsWith("/npx"), true)
  assert.deepStrictEqual(linux.args, [
    "--yes",
    "--ignore-scripts",
    "skills@1.5.18",
    "add",
    "/tmp/korean-law",
    "--global",
    "--skill",
    "korean-law",
    "--agent",
    "claude-code",
    "codex",
    "--yes",
    "--copy",
  ])
  assert.strictEqual(linux.env.LAW_OC, undefined)
  assert.strictEqual(linux.env.KOREAN_LAW_API_KEY, undefined)

  const windows = onDemand.buildSkillInstallInvocation(
    "C:\\korean-law",
    "win32",
    {
      Path: "C:\\Windows\\System32",
      LAW_OC: "must-not-leak",
      GITHUB_TOKEN: "must-not-leak",
    },
    "C:\\Program Files\\nodejs\\node.exe"
  )
  assert.strictEqual(windows.command.endsWith("npx.cmd"), true)
  assert.strictEqual(windows.env.Path, "C:\\Windows\\System32")
  assert.strictEqual(windows.env.LAW_OC, undefined)
  assert.strictEqual(windows.env.GITHUB_TOKEN, undefined)
  assert.deepStrictEqual(
    onDemand.getExpectedGlobalSkillFiles("/tmp/qa-home"),
    [
      "/tmp/qa-home/.claude/skills/korean-law/SKILL.md",
      "/tmp/qa-home/.agents/skills/korean-law/SKILL.md",
    ]
  )

  const manualEntry = setupWizard.buildManualConfigEntry()
  const serializedEntry = JSON.stringify(manualEntry)
  assert.strictEqual(serializedEntry.includes("LAW_OC"), false)
  assert.strictEqual(serializedEntry.includes("qa-secret-sentinel"), false)
  assert.strictEqual(serializedEntry.includes("korean-law-mcp@4.10.0"), true)
  assert.strictEqual(serializedEntry.includes("--ignore-scripts"), true)

  process.stdout.write("setup option tests passed\n")
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
