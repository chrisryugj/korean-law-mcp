import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { Writable } from "node:stream"

const discardOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback()
  },
})

export async function promptSecret(prompt: string): Promise<string> {
  const interactive = Boolean(stdin.isTTY && stdout.isTTY)
  const rl = createInterface({
    input: stdin,
    output: interactive ? discardOutput : stdout,
    terminal: interactive,
  })

  stdout.write(prompt)

  try {
    return (await rl.question("")).trim()
  } finally {
    stdout.write("\n")
    rl.close()
  }
}
