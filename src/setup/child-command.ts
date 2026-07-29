import { spawn } from "node:child_process"

export interface CommandInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<NodeJS.ProcessEnv>
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
): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
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
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8"))
        return
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim()
      reject(new Error(
        `Skill verification exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`
      ))
    })
  })
}
