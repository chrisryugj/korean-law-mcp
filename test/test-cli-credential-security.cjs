#!/usr/bin/env node

const assert = require("assert")
const { spawnSync } = require("child_process")

function runCli(args, extraEnv = {}) {
  return spawnSync(process.execPath, ["build/cli.js", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
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
