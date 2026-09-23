/**
 * 프로젝트 폴더에 쓰는 MCP 설정에는 API 키를 평문으로 넣지 않는다.
 *
 * setup 마법사는 Claude Code 의 `.mcp.json`, VS Code 의 `.vscode/mcp.json` 을 현재 디렉터리에 쓴다.
 * 이 파일들은 보통 git 에 커밋되므로 0600 권한으로는 키를 못 지킨다(2026-09-23 리뷰 D13).
 * 홈 디렉터리 설정(Claude Desktop·Cursor 등)은 커밋 대상이 아니라 종전대로 둔다.
 *
 * - Claude Code: `${LAW_OC}` 환경변수 확장(공식 지원). 키는 셸 환경변수로 둔다
 * - VS Code: `inputs` 의 password 입력(`${input:law-oc}`). VS Code 가 처음 실행 때 묻고 안전 저장한다
 */

export type ProjectClient = "claude-code" | "vscode"

export const VSCODE_KEY_INPUT = {
  type: "promptString",
  id: "law-oc",
  description: "법제처 Open API 인증키(OC)",
  password: true,
} as const

/** 서버 항목의 env.LAW_OC 를 참조로 바꾼다. 키를 받지 않았으면(빈 문자열) 손대지 않는다 */
export function withKeyReference(entry: Record<string, unknown>, client: ProjectClient): Record<string, unknown> {
  const env = { ...(entry.env as Record<string, string> | undefined) }
  if (!env.LAW_OC) return entry
  env.LAW_OC = client === "vscode" ? "${input:law-oc}" : "${LAW_OC}"
  return { ...entry, env }
}

/** VS Code 설정에 키 입력 정의를 한 번만 넣는다 */
export function withVscodeKeyInput(config: Record<string, unknown>): Record<string, unknown> {
  const inputs = Array.isArray(config.inputs) ? config.inputs as Array<{ id?: unknown }> : []
  if (inputs.some(i => i?.id === VSCODE_KEY_INPUT.id)) return config
  return { ...config, inputs: [...inputs, { ...VSCODE_KEY_INPUT }] }
}
