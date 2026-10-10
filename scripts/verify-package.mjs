import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const buildDir = resolve(root, "build")
const sourceDir = resolve(root, "src")
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function walk(directory) {
  const entries = []
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name)
    if (statSync(path).isDirectory()) entries.push(...walk(path))
    else entries.push(path)
  }
  return entries
}

function sourcePathForBuildFile(buildFile) {
  const relativeBuildPath = relative(buildDir, buildFile)
  if (relativeBuildPath.endsWith(".d.ts")) {
    return resolve(sourceDir, relativeBuildPath.slice(0, -".d.ts".length) + ".ts")
  }
  if (relativeBuildPath.endsWith(".js")) {
    return resolve(sourceDir, relativeBuildPath.slice(0, -".js".length) + ".ts")
  }
  return undefined
}

function assertPathInPackage(path, label) {
  const resolved = resolve(root, path)
  assert(resolved === root || resolved.startsWith(`${root}${sep}`), `${label} resolves outside the package.`)
  assert(existsSync(resolved), `${label} is missing from the clean build: ${path}`)
}

function verifyExportTargets(value, label = "exports") {
  if (typeof value === "string") {
    if (value.includes("*")) {
      const prefix = value.slice(0, value.indexOf("*"))
      assertPathInPackage(prefix, label)
    } else {
      assertPathInPackage(value, label)
    }
    return
  }
  if (value && typeof value === "object") {
    for (const [key, target] of Object.entries(value)) verifyExportTargets(target, `${label}.${key}`)
  }
}

function packedFiles() {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed:\n${result.stderr || result.stdout}`)
  }
  const output = result.stdout.trim()
  const start = output.indexOf("[")
  assert(start >= 0, "npm pack --dry-run did not return JSON.")
  const pack = JSON.parse(output.slice(start))
  assert(Array.isArray(pack) && pack.length === 1 && Array.isArray(pack[0].files), "npm pack --dry-run returned an unexpected file list.")
  return pack[0].files.map(file => file.path)
}

export function verifyPackageArtifacts() {
  assert(existsSync(buildDir), "build/ is missing. Run npm run build before verification.")

  for (const buildFile of walk(buildDir)) {
    const sourceFile = sourcePathForBuildFile(buildFile)
    if (sourceFile) {
      assert(existsSync(sourceFile), `Stale build output has no source module: ${relative(root, buildFile)}`)
    }
  }

  assertPathInPackage(packageJson.main, "main")
  assertPathInPackage(packageJson.types, "types")
  for (const [name, target] of Object.entries(packageJson.bin ?? {})) {
    assertPathInPackage(target, `bin.${name}`)
  }
  verifyExportTargets(packageJson.exports)

  // MCP 레지스트리 메타(server.json)가 게시 버전·mcpName 과 어긋나면 레지스트리 등록이 거부된다
  const serverJson = JSON.parse(readFileSync(resolve(root, "server.json"), "utf8"))
  assert(serverJson.version === packageJson.version, `server.json version ${serverJson.version} ≠ package.json ${packageJson.version}`)
  assert(serverJson.name === packageJson.mcpName, `server.json name ${serverJson.name} ≠ package.json mcpName ${packageJson.mcpName}`)

  // Claude 플러그인 매니페스트 버전도 게시 버전과 맞춘다(디렉터리·마켓플레이스에 그대로 노출된다)
  const pluginJson = JSON.parse(readFileSync(resolve(root, ".claude-plugin/plugin.json"), "utf8"))
  const marketplaceJson = JSON.parse(readFileSync(resolve(root, ".claude-plugin/marketplace.json"), "utf8"))
  assert(pluginJson.version === packageJson.version, `.claude-plugin/plugin.json version ${pluginJson.version} ≠ package.json ${packageJson.version}`)
  // 디렉터리는 npx 실행 패키지가 정확한 버전으로 고정돼야 받는다(@latest 는 차단)
  const launchArgs = pluginJson.mcpServers["korean-law"].args
  assert(launchArgs.includes(`korean-law-mcp@${packageJson.version}`), `.claude-plugin/plugin.json mcpServers args must pin korean-law-mcp@${packageJson.version}`)
  for (const plugin of marketplaceJson.plugins) {
    assert(plugin.version === packageJson.version, `.claude-plugin/marketplace.json ${plugin.name} version ${plugin.version} ≠ package.json ${packageJson.version}`)
  }

  const allowedTopLevel = new Set(["README.md", "LICENSE", "NOTICE", "package.json"])
  const files = packedFiles()
  for (const file of files) {
    assert(file.startsWith("build/") || allowedTopLevel.has(file), `Unexpected packed artifact: ${file}`)
    assert(!file.includes("sse-server"), `Stale server artifact would be published: ${file}`)
  }

  console.log(`package artifacts verified (${files.length} packed files)`)
}

verifyPackageArtifacts()
