#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import { z } from "zod"

const PACKAGE_FILE = new URL("../package.json", import.meta.url)
const REGISTRY_BASE_URL = "https://registry.npmjs.org"
const REQUEST_TIMEOUT_MS = 10_000
const PackageIdentitySchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
})
const ExpectationSchema = z.enum(["absent", "published"])
const RegistryMetadataSchema = z.object({
  versions: z.record(z.string(), z.unknown()),
})

function writeError(message) {
  process.stderr.write(`${message}\n`)
}

async function main() {
  const packageJson = JSON.parse(await readFile(PACKAGE_FILE, "utf8"))
  const { name, version } = PackageIdentitySchema.parse(packageJson)
  const expectation = ExpectationSchema.parse(process.argv[2] ?? "absent")

  const response = await fetch(
    `${REGISTRY_BASE_URL}/${encodeURIComponent(name)}`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  )
  if (!response.ok) {
    throw new Error(
      `npm registry 조회 실패 / Registry request failed: HTTP ${response.status}`
    )
  }

  const { versions } = RegistryMetadataSchema.parse(await response.json())
  const isPublished = Object.prototype.hasOwnProperty.call(versions, version)
  if (expectation === "absent" && isPublished) {
    throw new Error(
      `${name}@${version}은 이미 배포됐습니다. / This version is already published.`
    )
  }
  if (expectation === "published" && !isPublished) {
    throw new Error(
      `${name}@${version}을 npm에서 찾지 못했습니다. / This version is not published.`
    )
  }

  const result = isPublished
    ? "npm 배포 확인 / npm publication verified"
    : "배포 버전 사용 가능 / release version is available"
  process.stdout.write(`${name}@${version} ${result}\n`)
}

main().catch((error) => {
  writeError(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
