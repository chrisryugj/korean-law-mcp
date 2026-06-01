# 공정위 결정문 — 로컬 LLM RAG 결합 가이드

> Korean Law MCP v4.0 기반 / 1차: 로컬 LLM, 최종: 사람 검수

---

## 1. 본문 다운로드 — 두 가지 경로

### 경로 A: 구조화 텍스트 (`get_decision_text`) ← RAG 메인

법제처 API가 본문을 **이미 섹션별로 분리된 JSON**으로 반환함. 별도 PDF 파싱 불필요.

```js
const full = await mcp.call("get_decision_text", {
  domain: "ftc",
  id: "결정문일련번호"
})
```

응답 필드 (`src/tools/committee-decisions.ts:247-275`):

| 필드 | 용도 | RAG 활용 |
|------|------|----------|
| `사건명`, `사건번호`, `결정일자` | 식별자 | 메타 |
| `당사자`, `피심인` | 당사자 정보 | 메타필터 |
| `결정유형` | 시정명령/과징금/고발/무혐의 | enum 메타 |
| `주문` | 처분 내용 | 청킹 단위 1 (짧고 핵심) |
| `결정요지`/`요지` | 요약 | 청킹 단위 2 (검색용 keyword) |
| `이유` | 사실관계+법리 | 청킹 단위 3 (의미검색 메인) |
| `참조조문` | 적용 법령 | 메타필터 핵심 |
| `결정내용`/`전문` | 풀 본문 | 백업 청크 |

### 경로 B: 원본 파일 다운로드 (`결정문상세링크`)

`search_decisions` 응답에 `상세링크`가 포함됨 (`src/tools/committee-decisions.ts:181`). 법제처 사이트의 PDF/HWP 원본으로 직링크.

```js
const search = await mcp.call("search_decisions", {
  domain: "ftc", query: "담합", sort: "ddes"
})
const url = search.items[0].상세링크
// → https://www.law.go.kr/LSW/admDecInfoP.do?... 형태
```

**언제 쓰나**: 별표/도표/서명 이미지가 필요할 때, 또는 전문 그대로 보존이 요구될 때 (소송·심사 자료). 일반 RAG는 경로 A로 충분.

---

## 2. 통합 파이프라인

```
                      ┌─────────────────────────────┐
                      │  로컬 LLM (Qwen2.5 / Llama) │
                      │  + tool calling             │
                      └──────────────┬──────────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                ↓                    ↓                    ↓
        ┌──────────────┐     ┌──────────────┐    ┌────────────────┐
        │  RAG (벡터)  │     │ MCP (HTTP)   │    │ verify_citations│
        │ 사전 임베딩  │     │ 실시간 검색  │    │   환각 검증    │
        │ FTC 의결서   │     │ search/get   │    │                │
        │ + 자주쓰는법 │     │ time_travel  │    │                │
        └──────────────┘     └──────────────┘    └────────────────┘
                                     │
                            ┌────────▼────────┐
                            │  법제처 OpenAPI │
                            └─────────────────┘
                                     │
                            ┌────────▼────────┐
                            │ 1차 답변 + 인용 │
                            └────────┬────────┘
                                     ↓
                            ┌─────────────────┐
                            │ 사람 최종 검수  │
                            └─────────────────┘
```

---

## 3. RAG 인덱싱 — 청킹 전략

### 청킹 규칙

```python
def chunk_ftc_decision(full):
    chunks = []

    # 1. 주문 — 짧고 사실적, 통째 1청크
    chunks.append({
        "type": "주문",
        "text": full["주문"],
        "weight": 1.5  # 처분 핵심
    })

    # 2. 결정요지 — 짧으면 통째, 길면 문단별
    chunks.append({
        "type": "요지",
        "text": full["결정요지"]
    })

    # 3. 이유 — 1500토큰 슬라이딩 윈도우 (overlap 200)
    for piece in sliding_window(full["이유"], size=1500, overlap=200):
        chunks.append({"type": "이유", "text": piece})

    # 4. 참조조문 — 청킹 X, 메타데이터로만
    return chunks, parse_refs(full["참조조문"])
```

### 메타데이터 (필수)

```json
{
  "결정문일련번호": "...",
  "사건번호": "2024공정-1234",
  "결정일자": "2026-05-08",
  "결정유형": "시정명령",
  "피심인": "...",
  "참조조문": ["공정거래법 제19조", "공정거래법 시행령 제21조"],
  "원문링크": "https://www.law.go.kr/LSW/..."
}
```

**왜 참조조문이 메타에 가야 하나**: "공정거래법 제19조 위반 사례 보여줘" 같은 질의는 벡터검색보다 메타필터가 압도적으로 정확함. 의미검색은 사실관계 유사도 질의에만 사용.

---

## 4. 자동 리프레쉬 — 일 1회 cron

### 동기화 스크립트

```js
// daily-ftc-sync.mjs  (cron: 0 3 * * *)
import { mcpClient, vectorDB, db } from "./deps.mjs"

const lastSyncedId = await db.getLastFtcId() ?? "0"

let page = 1, newItems = []
while (true) {
  const res = await mcpClient.call("search_decisions", {
    domain: "ftc",
    query: " ",            // 전체 (공백 OK)
    sort: "ddes",          // 결정일 내림차순
    display: 100,
    page
  })

  const fresh = res.items.filter(d => d.결정일련번호 > lastSyncedId)
  if (fresh.length === 0) break       // 이미 본 ID 도달 → 종료
  newItems.push(...fresh)
  if (fresh.length < res.items.length) break
  page++
}

for (const item of newItems) {
  const full = await mcpClient.call("get_decision_text", {
    domain: "ftc", id: item.결정일련번호
  })

  const chunks = chunkFtcDecision(full)
  for (const c of chunks) {
    await vectorDB.upsert({
      id: `${item.결정일련번호}-${c.type}-${c.idx}`,
      vector: await embed(c.text),
      meta: {
        결정문일련번호: item.결정일련번호,
        사건번호: item.사건번호,
        결정일자: item.결정일자,
        결정유형: item.결정유형,
        피심인: full.피심인,
        참조조문: parseRefs(full.참조조문),
        원문링크: item.상세링크,
        청크유형: c.type
      }
    })
  }
}

if (newItems.length > 0) {
  await db.setLastFtcId(newItems[0].결정일련번호)
}
console.log(`동기화 완료: ${newItems.length}건`)
```

### 핵심 포인트

| 포인트 | 이유 |
|--------|------|
| `sort=ddes` | 최신순 → 첫 페이지부터 신규건 |
| ID 기준 컷오프 | 결정일자 기준은 의결-게시 갭 때문에 누락 위험. ID는 단조증가 |
| `display=100` | 최대치, 일 신규건 50개 미만이라 1페이지로 끝남 |
| 페이지네이션 종료 조건 | "이미 본 ID 도달"이면 break |
| 일 1회 03:00 KST | 법제처 게시는 영업시간 분산 → 새벽 1회로 충분 |

---

## 5. 질의 라우팅

로컬 LLM이 받은 질의를 RAG / MCP 중 어디로 보낼지:

```python
def route(query):
    # 메타필터 우선
    if has_law_ref(query):       # "공정거래법 제19조 …"
        return rag.filter(참조조문=ref) + rag.semantic(query)

    if has_party(query):          # "△△기업 사례"
        return rag.filter(피심인_like=party)

    if asks_recent(query):        # "최근 1주일", "어제"
        return mcp.call("search_decisions", {...})  # 실시간

    if asks_compare_periods(query):  # "2024 vs 2026"
        return mcp.call("time_travel", {...})

    # 기본: 의미검색 → 답변 후 verify_citations
    hits = rag.semantic(query, top_k=5)
    answer = llm(query, hits)
    return mcp.call("verify_citations", {answer})
```

---

## 6. 답변 검증 — `verify_citations` (필수)

LLM이 만든 답변에 인용된 조문/의결서가 **실제 존재하는지** 후처리 검증. v3.5 킬러기능.

```js
const verified = await mcp.call("verify_citations", {
  text: llmAnswer,
  strict: true
})
// → 존재하지 않는 인용은 마킹돼서 사람 검수자에게 전달
```

이거 안 붙이면 로컬 LLM이 "공정거래법 제999조" 같은 환각 인용을 그럴듯하게 뽑아냄.

---

## 7. 운영 체크리스트

- [ ] MCP 서버 HTTP stateless 모드 기동 (`PORT=8080 LAW_OC=키 node build/index.js --http`)
- [ ] 벡터DB (Qdrant/pgvector/Milvus) 컬렉션 생성 + 메타필드 인덱스
- [ ] 초기 backfill: 과거 N년치 FTC 의결서 일괄 동기화
- [ ] cron 등록: `0 3 * * * /usr/bin/node /path/daily-ftc-sync.mjs`
- [ ] 동기화 모니터링: 신규건 0건이 3일 연속이면 알림 (게시 정상인지)
- [ ] LLM 응답 파이프라인 마지막에 `verify_citations` 강제
- [ ] 사람 검수 UI에 `원문링크` 노출 (PDF/HWP 원본 즉시 확인용)

---

## 요약

- 본문은 `get_decision_text`로 구조화 텍스트 직접 수신 — PDF 파싱 불요
- 원본 파일 필요시 `결정문상세링크`로 직다운
- RAG 청킹은 주문/요지/이유 분리, 참조조문은 메타필터로
- 자동 리프레쉬는 일 1회, 결정문일련번호 기준 컷오프가 안전
- `verify_citations` 후처리로 LLM 환각 차단
