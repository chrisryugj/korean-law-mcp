import { spawn } from "node:child_process"

export interface CommandInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<NodeJS.ProcessEnv>
}

export interface CommandOutput {
  readonly stdout: string
  readonly stderr: string
}

const MAX_DIAGNOSTIC_OUTPUT_LENGTH = 2_000

function truncateDiagnostic(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= MAX_DIAGNOSTIC_OUTPUT_LENGTH) return normalized
  return `${normalized.slice(0, MAX_DIAGNOSTIC_OUTPUT_LENGTH)}…`
}

export function formatCommandOutput(output: CommandOutput): string {
  const details = [
    output.stdout ? `stdout: ${truncateDiagnostic(output.stdout)}` : "",
    output.stderr ? `stderr: ${truncateDiagnostic(output.stderr)}` : "",
  ].filter(Boolean)
  return details.length > 0 ? ` (${details.join(" | ")})` : ""
}

export async function runCommand(invocation: CommandInvocation): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: "inherit",
      env: invocation.env,
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`Skill installer exited with code ${code ?? "unknown"}`))
    })
  })
}

export async function captureCommand(
  invocation: CommandInvocation
): Promise<CommandOutput> {
  return await new Promise<CommandOutput>((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: invocation.env,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.once("error", reject)
    child.once("close", (code) => {
      const output = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }
      if (code === 0) {
        resolvePromise(output)
        return
      }
      reject(new Error(
        `Skill 검증이 코드 ${code ?? "unknown"}로 종료되었습니다. / ` +
        `Skill verification exited with code ${code ?? "unknown"}` +
        formatCommandOutput(output)
      ))
    })
  })
}
