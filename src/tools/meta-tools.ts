/**
 * Meta Tools — lite 프로필에서 전체 도구 접근을 위한 디스커버리/실행 도구
 *
 * discover_tools: 의도/카테고리로 사용 가능한 도구 목록 반환
 * execute_tool:   discover로 찾은 도구를 프록시 실행
 */

import { z } from "zod"
import { TOOL_CATEGORIES, TOOL_ALIASES } from "../lib/tool-profiles.js"
import { formatToolError } from "../lib/errors.js"
import type { LawApiClient } from "../lib/api-client.js"
import type { McpTool, ToolResponse } from "../lib/types.js"

// allTools 참조 (순환참조 방지를 위해 런타임 주입)
let _allTools: McpTool[] = []
export function setAllToolsRef(tools: McpTool[]) {
  _allTools = tools
}

// ========================================
// discover_tools
// ========================================

export const DiscoverToolsSchema = z.object({
  intent: z.string().describe("찾고 싶은 도구의 의도 또는 카테고리 (예: '공정위', '조약', '용어', '헌재')"),
})

/**
 * 별칭/자연어 입력을 카테고리명으로 해석.
 * TOOL_ALIASES에서 매칭되는 경우 해당 카테고리 키 반환, 없으면 undefined.
 */
function resolveAliasToCategory(query: string): string | undefined {
  const q = query.toLowerCase().trim()
  for (const [category, aliases] of Object.entries(TOOL_ALIASES)) {
    for (const alias of aliases) {
      const lowAlias = alias.toLowerCase()
      if (q === lowAlias || q.includes(lowAlias) || lowAlias.includes(q)) {
        return category
      }
    }
  }
  return undefined
}

/**
 * 별칭이 특정 도구명(search_xxx, chain_xxx, verify_xxx)을 가리키는지 확인.
 * 매칭되면 도구 이름 배열 반환, 없으면 undefined.
 */
function resolveAliasToTools(query: string): string[] | undefined {
  const q = query.toLowerCase().trim()
  for (const aliases of Object.values(TOOL_ALIASES)) {
    for (const alias of aliases) {
      if (/^(search_|chain_|verify_|get_|analyze_)/.test(alias)) {
        // 별칭 배열에 도구 이름이 섞여 있는 경우 (처분기준, 문서검토 등)
        if (q === alias.toLowerCase() || q.includes(alias.toLowerCase())) {
          return aliases.filter((a) => /^(search_|chain_|verify_|get_|analyze_)/.test(a))
        }
      }
    }
  }
  return undefined
}

export async function discoverTools(
  _apiClient: LawApiClient,
  input: z.infer<typeof DiscoverToolsSchema>
): Promise<ToolResponse> {
  const query = input.intent.toLowerCase()
  const matches: Array<{ category: string; tools: string[] }> = []

  // 1단계: 별칭 → 카테고리 해석
  const aliasCategory = resolveAliasToCategory(query)

  // 2단계: 별칭 → 특정 도구 매칭
  const aliasTools = resolveAliasToTools(query)
  if (aliasTools && aliasTools.length > 0) {
    matches.push({ category: `별칭 매칭 (${input.intent})`, tools: aliasTools })
  }

  for (const [category, toolNames] of Object.entries(TOOL_CATEGORIES)) {
    // 별칭으로 해석된 카테고리는 무조건 포함
    if (aliasCategory === category) {
      matches.push({ category, tools: toolNames })
      continue
    }
    if (category.includes(query) || query.includes(category)) {
      matches.push({ category, tools: toolNames })
      continue
    }
    // 도구 이름/설명에서도 매칭
    const matchedTools = toolNames.filter(name => {
      const tool = _allTools.find(t => t.name === name)
      if (!tool) return false
      return name.includes(query) || tool.description.toLowerCase().includes(query)
    })
    if (matchedTools.length > 0) {
      matches.push({ category, tools: matchedTools })
    }
  }

  if (matches.length === 0) {
    // 전체 카테고리 목록 반환
    const categoryList = Object.entries(TOOL_CATEGORIES)
      .map(([cat, tools]) => `• ${cat}: ${tools.length}개 도구`)
      .join("\n")
    return {
      content: [{ type: "text", text: `"${input.intent}"에 해당하는 도구를 찾지 못했습니다.\n\n사용 가능한 카테고리:\n${categoryList}\n\n카테고리명으로 다시 검색해주세요.` }]
    }
  }

  const sections = matches.map(m => {
    const toolDetails = m.tools.map(name => {
      const tool = _allTools.find(t => t.name === name)
      return `  - ${name}: ${tool?.description || "(설명 없음)"}`
    }).join("\n")
    return `[${m.category}]\n${toolDetails}`
  }).join("\n\n")

  return {
    content: [{ type: "text", text: `"${input.intent}" 관련 도구:\n\n${sections}\n\nexecute_tool로 실행하세요.` }]
  }
}

// ========================================
// execute_tool
// ========================================

export const ExecuteToolSchema = z.object({
  tool_name: z.string().describe("실행할 도구 이름 (discover_tools로 확인한 이름)"),
  params: z.record(z.string(), z.unknown()).describe("도구에 전달할 파라미터 객체"),
})

const META_TOOL_NAMES = new Set(["discover_tools", "execute_tool"])

export async function executeTool(
  apiClient: LawApiClient,
  input: z.infer<typeof ExecuteToolSchema>
): Promise<ToolResponse> {
  // 메타 도구 자기 자신 재귀 호출 방지
  if (META_TOOL_NAMES.has(input.tool_name)) {
    return {
      content: [{ type: "text", text: `메타 도구(${input.tool_name})는 execute_tool로 실행할 수 없습니다.` }],
      isError: true
    }
  }

  const tool = _allTools.find(t => t.name === input.tool_name)
  if (!tool) {
    return {
      content: [{ type: "text", text: `도구를 찾을 수 없습니다: ${input.tool_name}\ndiscover_tools로 사용 가능한 도구를 먼저 확인하세요.` }],
      isError: true
    }
  }

  try {
    const parsed = tool.schema.parse(input.params)
    return await tool.handler(apiClient, parsed) as ToolResponse
  } catch (error) {
    return formatToolError(error as Error, input.tool_name)
  }
}
