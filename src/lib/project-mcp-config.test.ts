import { describe, it, expect } from "vitest"
import { withKeyReference, withVscodeKeyInput, VSCODE_KEY_INPUT } from "./project-mcp-config.js"

// 2026-09-23 리뷰 D13: 현재 디렉터리의 .mcp.json·.vscode/mcp.json 은 커밋되는 파일인데 키가 평문으로 들어갔다
const entry = { command: "npx", args: ["-y", "korean-law-mcp"], env: { LAW_OC: "realkey123", LAW_API_PROTOCOL: "http" } }

describe("withKeyReference", () => {
  it("Claude Code 는 ${LAW_OC} 환경변수 참조로 바꾼다 (다른 env 는 유지)", () => {
    const out = withKeyReference(entry, "claude-code")
    expect(out.env).toEqual({ LAW_OC: "${LAW_OC}", LAW_API_PROTOCOL: "http" })
    expect(JSON.stringify(out)).not.toContain("realkey123")
  })

  it("VS Code 는 ${input:law-oc} 입력 참조로 바꾼다", () => {
    expect((withKeyReference(entry, "vscode").env as Record<string, string>).LAW_OC).toBe("${input:law-oc}")
  })

  it("키를 받지 않았으면 그대로 둔다", () => {
    const noKey = { ...entry, env: {} }
    expect(withKeyReference(noKey, "claude-code")).toBe(noKey)
  })

  it("원본 항목을 바꾸지 않는다 (다른 클라이언트에 같은 항목을 쓴다)", () => {
    withKeyReference(entry, "claude-code")
    expect(entry.env.LAW_OC).toBe("realkey123")
  })
})

describe("withVscodeKeyInput", () => {
  it("입력 정의를 추가하고 기존 inputs 는 보존한다", () => {
    const out = withVscodeKeyInput({ inputs: [{ id: "other" }], servers: {} })
    expect(out.inputs).toEqual([{ id: "other" }, VSCODE_KEY_INPUT])
  })

  it("이미 있으면 중복으로 넣지 않는다", () => {
    const once = withVscodeKeyInput({})
    expect(withVscodeKeyInput(once)).toBe(once)
  })
})
