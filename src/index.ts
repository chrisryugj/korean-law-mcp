#!/usr/bin/env node

/**
 * Korean Law MCP Server
 * 국가법령정보센터 API 기반 MCP 서버
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import { LawApiClient } from "./lib/api-client.js"
import { searchLaw, SearchLawSchema } from "./tools/search.js"
import { getLawText, GetLawTextSchema } from "./tools/law-text.js"
import { parseJoCode, ParseJoCodeSchema } from "./tools/utils.js"
import { compareOldNew, CompareOldNewSchema } from "./tools/comparison.js"
import { getThreeTier, GetThreeTierSchema } from "./tools/three-tier.js"
import { startSSEServer } from "./server/sse-server.js"

// 환경변수 확인
const LAW_OC = process.env.LAW_OC
if (!LAW_OC) {
  console.error("Error: LAW_OC 환경변수가 설정되지 않았습니다")
  console.error("법제처 오픈API 인증키를 LAW_OC 환경변수로 설정해주세요")
  console.error("발급: https://www.law.go.kr/DRF/lawService.do")
  process.exit(1)
}

// API 클라이언트 초기화
const apiClient = new LawApiClient({ apiKey: LAW_OC })

// MCP 서버 생성
const server = new Server(
  {
    name: "korean-law",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// ListTools 핸들러
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_law",
        description: "한국 법령을 검색합니다. 법령명 약칭도 자동으로 인식합니다 (예: '화관법' → '화학물질관리법')",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색할 법령명 (예: '관세법', 'fta특례법', '화관법')"
            },
            maxResults: {
              type: "number",
              description: "최대 결과 개수 (기본값: 20)",
              default: 20
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_law_text",
        description: "법령의 조문 전문을 조회합니다. 조문 번호는 한글('제38조') 또는 JO 코드('003800') 모두 사용 가능합니다.",
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호 (search_law에서 획득)"
            },
            lawId: {
              type: "string",
              description: "법령ID (search_law에서 획득)"
            },
            jo: {
              type: "string",
              description: "조문 번호 (예: '제38조' 또는 '003800')"
            },
            efYd: {
              type: "string",
              description: "시행일자 (YYYYMMDD 형식)"
            }
          },
          required: []
        }
      },
      {
        name: "parse_jo_code",
        description: "조문 번호를 JO 코드와 한글 간 양방향 변환합니다 (예: '제38조' ↔ '003800')",
        inputSchema: {
          type: "object",
          properties: {
            joText: {
              type: "string",
              description: "변환할 조문 번호"
            },
            direction: {
              type: "string",
              enum: ["to_code", "to_text"],
              description: "변환 방향 (기본값: to_code)",
              default: "to_code"
            }
          },
          required: ["joText"]
        }
      },
      {
        name: "compare_old_new",
        description: "법령의 신구법 대조 (개정 전후 비교)를 조회합니다.",
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawId: {
              type: "string",
              description: "법령ID"
            },
            ld: {
              type: "string",
              description: "공포일자 (YYYYMMDD)"
            },
            ln: {
              type: "string",
              description: "공포번호"
            }
          },
          required: []
        }
      },
      {
        name: "get_three_tier",
        description: "법령의 3단비교 (법률→시행령→시행규칙 위임 관계)를 조회합니다.",
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawId: {
              type: "string",
              description: "법령ID"
            },
            knd: {
              type: "string",
              enum: ["1", "2"],
              description: "1=인용조문, 2=위임조문 (기본값: 2)",
              default: "2"
            }
          },
          required: []
        }
      }
    ]
  }
})

// CallTool 핸들러
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params

    switch (name) {
      case "search_law": {
        const input = SearchLawSchema.parse(args)
        return await searchLaw(apiClient, input)
      }

      case "get_law_text": {
        const input = GetLawTextSchema.parse(args)
        return await getLawText(apiClient, input)
      }

      case "parse_jo_code": {
        const input = ParseJoCodeSchema.parse(args)
        return await parseJoCode(input)
      }

      case "compare_old_new": {
        const input = CompareOldNewSchema.parse(args)
        return await compareOldNew(apiClient, input)
      }

      case "get_three_tier": {
        const input = GetThreeTierSchema.parse(args)
        return await getThreeTier(apiClient, input)
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      }
    }
    throw error
  }
})

// 서버 시작
async function main() {
  // CLI 인자 파싱
  const args = process.argv.slice(2)
  const modeIndex = args.indexOf("--mode")
  const portIndex = args.indexOf("--port")

  const mode = modeIndex >= 0 ? args[modeIndex + 1] : "stdio"
  const port = portIndex >= 0 ? parseInt(args[portIndex + 1]) : 3000

  if (mode === "sse") {
    // SSE 모드 (리모트 배포용)
    console.error("Starting Korean Law MCP server in SSE mode...")
    await startSSEServer(server, port)
  } else {
    // STDIO 모드 (로컬 Claude Desktop용)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error("✓ Korean Law MCP server running on stdio")
    console.error("✓ API Key:", LAW_OC ? "Configured" : "✗ Missing")
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
