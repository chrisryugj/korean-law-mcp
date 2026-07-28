import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  type Stats,
} from "node:fs"
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
} from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { basename, dirname, resolve } from "node:path"
import { platform } from "node:os"
import { z } from "zod"

const MAX_PRIVATE_JSON_BYTES = 1024 * 1024
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const JsonObjectSchema = z.record(z.string(), z.unknown())
const READ_NOFOLLOW_FLAGS = constants.O_RDONLY |
  constants.O_NONBLOCK |
  (platform() === "win32" ? 0 : constants.O_NOFOLLOW)

function isMissingFile(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
}

function assertSafeStats(stats: Stats, filePath: string): void {
  if (stats.isSymbolicLink()) {
    throw new Error(`심볼릭 링크 설정 파일은 거부됩니다. / Symlink config rejected: ${filePath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`일반 파일이 아닌 설정 경로입니다. / Config is not a regular file: ${filePath}`)
  }
  if (stats.size > MAX_PRIVATE_JSON_BYTES) {
    throw new Error(`설정 파일이 너무 큽니다. / Config file is too large: ${filePath}`)
  }
}

function assertSameFile(
  pathStats: Stats,
  handleStats: Stats,
  filePath: string
): void {
  if (pathStats.dev !== handleStats.dev || pathStats.ino !== handleStats.ino) {
    throw new Error(
      `설정 파일이 읽는 중 교체되었습니다. / Config changed while opening: ${filePath}`
    )
  }
}

export function readPrivateJsonFileSync(filePath: string): unknown {
  const beforeOpen = lstatSync(filePath)
  assertSafeStats(beforeOpen, filePath)
  const descriptor = openSync(filePath, READ_NOFOLLOW_FLAGS)
  try {
    const handleStats = fstatSync(descriptor)
    const afterOpen = lstatSync(filePath)
    assertSafeStats(handleStats, filePath)
    assertSafeStats(afterOpen, filePath)
    assertSameFile(beforeOpen, handleStats, filePath)
    assertSameFile(afterOpen, handleStats, filePath)
    return JSON.parse(readFileSync(descriptor, "utf8"))
  } finally {
    closeSync(descriptor)
  }
}

export async function readPrivateJsonObject(
  filePath: string
): Promise<Record<string, unknown>> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const beforeOpen = await lstat(filePath)
    assertSafeStats(beforeOpen, filePath)
    handle = await open(filePath, READ_NOFOLLOW_FLAGS)
    const handleStats = await handle.stat()
    const afterOpen = await lstat(filePath)
    assertSafeStats(handleStats, filePath)
    assertSafeStats(afterOpen, filePath)
    assertSameFile(beforeOpen, handleStats, filePath)
    assertSameFile(afterOpen, handleStats, filePath)
    return JsonObjectSchema.parse(JSON.parse(await handle.readFile("utf8")))
  } catch (error) {
    if (isMissingFile(error)) return {}
    throw error
  } finally {
    await handle?.close()
  }
}

async function assertSafeWriteTarget(filePath: string): Promise<void> {
  try {
    assertSafeStats(await lstat(filePath), filePath)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
}

async function writeTemporaryFile(
  temporaryPath: string,
  contents: string
): Promise<void> {
  const handle = await open(temporaryPath, "wx", PRIVATE_FILE_MODE)
  try {
    await handle.writeFile(contents, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function writePrivateJsonFile(
  filePath: string,
  data: Readonly<Record<string, unknown>>
): Promise<void> {
  await assertSafeWriteTarget(filePath)
  const directory = dirname(filePath)
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })

  const temporaryPath = resolve(
    directory,
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  )
  try {
    await writeTemporaryFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`)
    await rename(temporaryPath, filePath)
    if (platform() !== "win32") {
      await chmod(filePath, PRIVATE_FILE_MODE)
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}
