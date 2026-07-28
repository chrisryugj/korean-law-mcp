#!/usr/bin/env node

const assert = require("assert")
const { spawnSync } = require("child_process")
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("fs")
const { tmpdir } = require("os")
const { join } = require("path")

function runCli(args, extraEnv = {}, input) {
  return spawnSync(process.execPath, ["build/cli.js", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      ...extraEnv,
      NO_COLOR: "1",
    },
  })
}

function combinedOutput(result) {
  return `${result.stdout || ""}${result.stderr || ""}`
}

async function main() {
  const cliInput = await import("../build/lib/cli-input.js")
  const shellPayload = "$(touch /tmp/korean-law-must-not-execute)"
  assert.strictEqual(cliInput.parseCliQueryInput(shellPayload), shellPayload)
  assert.throws(
    () => cliInput.parseDirectToolInput(
      JSON.stringify({ query: "민법", apiKey: "repl-json-secret" })
    ),
    /apiKey는 명령행에 넣을 수 없습니다/
  )
  assert.throws(
    () => cliInput.parseDirectToolInput("query=민법 apiKey=repl-key-value-secret"),
    /apiKey는 명령행에 넣을 수 없습니다/
  )

  const help = runCli(["help", "search_law"])
  assert.strictEqual(help.status, 0, combinedOutput(help))
  assert.strictEqual(combinedOutput(help).includes("--apiKey"), false)

  const queryHelp = runCli(["query", "--help"])
  assert.strictEqual(queryHelp.status, 0, combinedOutput(queryHelp))
  assert.match(combinedOutput(queryHelp), /--stdin/)

  const sandbox = mkdtempSync(join(tmpdir(), "korean-law-cli-"))
  const sentinel = join(sandbox, "executed")
  const maliciousQuestion = `$(touch ${sentinel})`
  const isolatedEnv = {
    HOME: sandbox,
    XDG_CONFIG_HOME: join(sandbox, ".config"),
    APPDATA: join(sandbox, "AppData"),
    LAW_OC: "",
    KOREAN_LAW_API_KEY: "",
  }
  const stdinQuery = runCli(
    ["query", "--stdin"],
    isolatedEnv,
    `${maliciousQuestion}\n`
  )
  assert.notStrictEqual(stdinQuery.status, 0)
  assert.strictEqual(existsSync(sentinel), false)
  assert.match(combinedOutput(stdinQuery), /MOLEG API key is required/)

  const missingQuestion = runCli(["query"], isolatedEnv)
  assert.notStrictEqual(missingQuestion.status, 0)
  assert.match(combinedOutput(missingQuestion), /Enter a question/)

  const mixedQuestion = runCli(
    ["query", "민법", "--stdin"],
    isolatedEnv,
    "ignored\n"
  )
  assert.notStrictEqual(mixedQuestion.status, 0)
  assert.match(combinedOutput(mixedQuestion), /Do not combine --stdin/)
  rmSync(sandbox, { recursive: true, force: true })

  const skill = readFileSync("skills/korean-law/SKILL.md", "utf8")
  assert.match(skill, /korean-law query --stdin/)
  assert.doesNotMatch(skill, /korean-law query ["']<(?:question|질문)>["']/)

  const argvSecret = "qa-argv-secret"
  const rejectedOption = runCli([
    "search_law",
    "--query",
    "민법",
    "--apiKey",
    argvSecret,
  ])
  assert.notStrictEqual(rejectedOption.status, 0)
  assert.strictEqual(combinedOutput(rejectedOption).includes(argvSecret), false)

  const jsonSecret = "qa-json-secret"
  const rejectedJson = runCli([
    "search_law",
    "--query",
    "민법",
    "--json-input",
    JSON.stringify({ query: "민법", apiKey: jsonSecret }),
  ], {
    LAW_OC: "qa-non-production-key",
  })
  assert.notStrictEqual(rejectedJson.status, 0)
  assert.strictEqual(combinedOutput(rejectedJson).includes(jsonSecret), false)
  assert.match(combinedOutput(rejectedJson), /apiKey는 명령행에 넣을 수 없습니다/)

  process.stdout.write("CLI credential security tests passed\n")
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
