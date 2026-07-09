# Korean Law MCP - 媛쒕컻??媛?대뱶

> **v2.3.2** | 湲곗뿬?먮? ?꾪븳 媛쒕컻 媛?대뱶

---

## 媛쒕컻 ?섍꼍 ?ㅼ젙

### ?붽뎄?ы빆

- **Node.js**: 18.0.0 ?댁긽
- **npm**: 9.0.0 ?댁긽
- **TypeScript**: 5.7+ (?꾨줈?앺듃 醫낆냽?깆뿉 ?ы븿)

### 珥덇린 ?ㅼ젙

```bash
git clone https://github.com/chrisryugj/korean-law-mcp.git
cd korean-law-mcp
npm install
npm run build
LAW_OC=your-api-key node build/index.js
```

### API ??諛쒓툒

[踰뺤젣泥?Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)?먯꽌 臾대즺 諛쒓툒.

---

## ?꾨줈?앺듃 援ъ“

```
korean-law-mcp/
?쒋?? src/
??  ?쒋?? index.ts              # MCP ?쒕쾭 吏꾩엯??(STDIO/HTTP 紐⑤뱶)
??  ?쒋?? cli.ts                # CLI ?명꽣?섏씠??
??  ?쒋?? tool-registry.ts      # 97媛??꾧뎄 ?깅줉 (allTools 諛곗뿴)
??  ?쒋?? lib/                  # 怨듯넻 ?쇱씠釉뚮윭由?(13媛??뚯씪)
??  ??  ?쒋?? api-client.ts     # API ?대씪?댁뼵??
??  ??  ?쒋?? annex-file-parser.ts  # HWPX/HWP/PDF 蹂꾪몴 ?뚯떛
??  ??  ?쒋?? article-parser.ts # 議곕Ц ?뚯꽌
??  ??  ?쒋?? cache.ts          # LRU 罹먯떆 (TTL)
??  ??  ?쒋?? errors.ts         # LawApiError ?대옒??
??  ??  ?쒋?? fetch-with-retry.ts  # 30珥???꾩븘?? 3???ъ떆??
??  ??  ?쒋?? law-parser.ts     # JO 肄붾뱶 蹂??(LexDiff ?먮낯)
??  ??  ?쒋?? schemas.ts        # ?좎쭨/?묐떟?ш린 寃利?
??  ??  ?쒋?? search-normalizer.ts  # ?쎌묶 ?뺢퇋??(LexDiff ?먮낯)
??  ??  ?쒋?? session-state.ts  # 硫?곗꽭??API ??寃⑸━
??  ??  ?쒋?? three-tier-parser.ts  # 3??鍮꾧탳 ?뚯꽌
??  ??  ?쒋?? types.ts          # 怨듯넻 ???
??  ??  ?붴?? xml-parser.ts     # 6媛??꾨찓?몃퀎 XML ?뚯꽌
??  ?쒋?? tools/                # ?꾧뎄 援ы쁽 (40媛??뚯씪)
??  ??  ?쒋?? search.ts         # search_law
??  ??  ?쒋?? law-text.ts       # get_law_text
??  ??  ?쒋?? admin-rule.ts     # search_admin_rule, get_admin_rule
??  ??  ?쒋?? ordinance-search.ts / ordinance.ts  # ?먯튂踰뺢퇋
??  ??  ?쒋?? precedents.ts     # search_precedents, get_precedent_text
??  ??  ?쒋?? interpretations.ts  # 踰뺣졊?댁꽍濡
??  ??  ?쒋?? chains.ts         # 7媛?泥댁씤 ?꾧뎄
??  ??  ?쒋?? batch-articles.ts # get_batch_articles
??  ??  ?쒋?? annex.ts          # get_annexes (蹂꾪몴 議고쉶+?뚯떛)
??  ??  ?쒋?? committee-decisions.ts  # 怨듭젙???몃룞??媛쒕낫??
??  ??  ?쒋?? constitutional-decisions.ts  # ?뚯옱 寃곗젙
??  ??  ?쒋?? admin-appeals.ts  # ?됱젙?ы뙋
??  ??  ?쒋?? customs-interpretations.ts / tax-tribunal-decisions.ts  # 愿??議곗꽭
??  ??  ?쒋?? english-law.ts / historical-law.ts  # ?곷Ц/?고쁺
??  ??  ?쒋?? knowledge-base.ts / kb-utils.ts / legal-terms.ts  # 吏?앸쿋?댁뒪
??  ??  ?쒋?? life-law.ts       # ?앺솢踰뺣졊
??  ??  ?붴?? ... (湲고? ?꾧뎄 ?뚯씪)
??  ?붴?? server/
??      ?쒋?? http-server.ts    # Streamable HTTP (MCP ?쒖?)
??      ?붴?? sse-server.ts     # SSE ?쒕쾭 (?덇굅??
?쒋?? build/                    # 鍮뚮뱶 寃곌낵 (JavaScript)
?쒋?? docs/                     # 臾몄꽌
?쒋?? Dockerfile                # Docker ?대?吏
?쒋?? fly.toml                  # Fly.io 諛고룷 ?ㅼ젙
?쒋?? package.json
?쒋?? tsconfig.json
?붴?? CLAUDE.md                 # Claude Code ?묒뾽 吏移?
```

---

## ???꾧뎄 異붽??섍린

### Step 1: ?꾧뎄 ?뚯씪 ?앹꽦

`src/tools/new-tool.ts`:

```typescript
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"

export const NewToolSchema = z.object({
  param1: z.string().describe("?뚮씪誘명꽣 ?ㅻ챸"),
  apiKey: z.string().optional().describe("API ??)
})

export type NewToolInput = z.infer<typeof NewToolSchema>

export async function newTool(
  apiClient: LawApiClient,
  input: NewToolInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const response = await apiClient.someMethod(input.param1, { apiKey: input.apiKey })
    return { content: [{ type: "text", text: formatResult(response) }] }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    }
  }
}
```

### Step 2: tool-registry.ts???깅줉

`src/tool-registry.ts`??`allTools` 諛곗뿴??異붽?:

```typescript
import { NewToolSchema, newTool } from "./tools/new-tool.js"

// allTools 諛곗뿴??異붽?
{
  name: "new_tool_name",
  description: "?꾧뎄 ?ㅻ챸",
  schema: NewToolSchema,
  handler: (client, input) => newTool(client, input)
}
```

### Step 3: 鍮뚮뱶 & ?뚯뒪??

```bash
npm run build
LAW_OC=your-key node build/index.js  # STDIO 紐⑤뱶 ?뚯뒪??
npx @modelcontextprotocol/inspector build/index.js  # Inspector ?뚯뒪??
```

---

## 媛쒕컻 ?뚰겕?뚮줈??

```bash
# Watch 紐⑤뱶
npm run watch

# ?ㅻⅨ ?곕??먯뿉???쒕쾭 ?ㅽ뻾
LAW_OC=your-key node build/index.js

# CLI ?뚯뒪??
npm run cli -- search_law --query "誘쇰쾿"
npm run cli -- list
```

### 而ㅻ컠 硫붿떆吏 洹쒖튃

Conventional Commits:
- `feat`: ??湲곕뒫
- `fix`: 踰꾧렇 ?섏젙
- `docs`: 臾몄꽌 蹂寃?
- `refactor`: 由ы뙥?좊쭅
- `chore`: 鍮뚮뱶/?ㅼ젙 蹂寃?

---

## 肄붾뱶 洹쒖튃

- **?뚯씪 ?ш린**: 200以?誘몃쭔 (珥덇낵 ??`src/lib/`濡?遺꾨━)
- **紐낅챸**: ?뚯씪 kebab-case, ?⑥닔 camelCase, ???PascalCase
- **Zod ?ㅽ궎留?*: 紐⑤뱺 ?꾧뎄 ?낅젰???꾩닔
- **LexDiff 肄붾뱶**: `search-normalizer.ts`, `law-parser.ts` ?섏젙 湲덉?

---

## 諛고룷

### npm

```bash
npm version patch  # 踰꾩쟾 bump
npm run build
npm publish
```

### Fly.io

```bash
flyctl deploy
```

### Docker

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-key -p 3000:3000 korean-law-mcp
```

---

## 李멸퀬 ?먮즺

- [MCP Specification](https://modelcontextprotocol.io)
- [Zod Documentation](https://zod.dev)
- [踰뺤젣泥?Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)
- [LexDiff](https://github.com/chrisryugj/lexdiff) - 寃?됱뼱 ?뺢퇋???먮낯

---

**Questions?** [GitHub Issues](https://github.com/chrisryugj/korean-law-mcp/issues)
