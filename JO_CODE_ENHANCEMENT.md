# JO Code Enhancement - 법령체계별 조코드 변환 지원 확대

## 📅 업데이트 일자
2025-12-20

## 🎯 개요
LexDiff 프로젝트 분석을 통해 법령체계별 조코드 변환 방식을 파악하고, Korean Law MCP 서버에 자치법규 및 레거시 8자리 코드 지원을 추가했습니다.

---

## 📊 법령체계별 조코드 형식

### 1. **법률/시행령/시행규칙** (기존 지원)
- **형식**: `AAAABB` (6자리)
- **구조**:
  - AAAA: 조문번호 (0001-9999)
  - BB: 지번(의X) (00-99)
- **예시**:
  - `제38조` → `003800`
  - `제10조의2` → `001002`
  - `제1조` → `000100`

### 2. **자치법규** (조례/규칙) ✨ NEW
- **형식**: `AABBCC` (6자리)
- **구조**:
  - AA: 조문번호 (01-99)
  - BB: 지번(의X) (00-99)
  - CC: 서브번호 (00-99)
- **예시**:
  - `제1조` → `010000`
  - `제1조의1` → `010100`
  - `제10조의2` → `100200`

### 3. **레거시 8자리 코드** ✨ NEW
- **형식**: `AAAABBCC` (8자리)
- **구조**:
  - AAAA: 조문번호 (0001-9999)
  - BB: 지번(의X) (00-99)
  - CC: 서브번호 (00-99)
- **예시**:
  - `00380001` → `제38조-1`
  - `00100203` → `제10조의2-3`

### 4. **행정규칙** (훈령/예규/고시)
- **형식**: 조코드 사용 안 함
- **저장**: `제1조`, `제2조` 등 문자열 그대로

---

## 🔧 코드 변경사항

### 1. **law-parser.ts** - 새 함수 추가

#### `buildOrdinanceJO()` 추가
```typescript
/**
 * Converts Korean ordinance article notation to 6-digit JO code (자치법규용)
 * Format: AABBCC (AA=article, BB=branch, CC=sub)
 */
export function buildOrdinanceJO(input: string): string {
  const components = parseArticleComponents(input)
  const articleNum = components.articleNumber.toString().padStart(2, "0")
  const branchNum = components.branchNumber.toString().padStart(2, "0")
  return `${articleNum}${branchNum}00`
}
```

#### `formatJO()` 확장
```typescript
/**
 * Formats JO code back to readable Korean
 * @param jo - JO code (6 or 8 digits)
 * @param isOrdinance - true for ordinance format (AABBCC), false for law format (AAAABB)
 */
export function formatJO(jo: string, isOrdinance = false): string {
  // Ordinance format: AABBCC (AA=article, BB=branch, CC=sub)
  if (isOrdinance && jo.length === 6 && /^\d{6}$/.test(jo)) {
    const articleNum = Number.parseInt(jo.substring(0, 2), 10)
    const branchNum = Number.parseInt(jo.substring(2, 4), 10)
    const subNum = Number.parseInt(jo.substring(4, 6), 10)

    let result = `제${articleNum}조`
    if (branchNum > 0) result += `의${branchNum}`
    if (subNum > 0) result += `-${subNum}`
    return result
  }

  // Law format: AAAABB (기존 로직)
  // ...

  // Legacy 8-digit format: AAAABBCC
  if (jo.length === 8 && /^\d{8}$/.test(jo)) {
    const articleNum = Number.parseInt(jo.substring(0, 4), 10)
    const branchNum = Number.parseInt(jo.substring(4, 6), 10)
    const subNum = Number.parseInt(jo.substring(6, 8), 10)

    let result = `제${articleNum}조`
    if (branchNum > 0) result += `의${branchNum}`
    if (subNum > 0) result += `-${subNum}`
    return result
  }

  return jo
}
```

### 2. **utils.ts** - parse_jo_code 도구 업데이트

#### Schema 확장
```typescript
export const ParseJoCodeSchema = z.object({
  joText: z.string().describe("변환할 조문 번호"),
  direction: z.enum(["to_code", "to_text"]).optional().default("to_code"),
  lawType: z.enum(["law", "ordinance"]).optional().default("law")
    .describe("법령 유형: law (법률/시행령/시행규칙, AAAABB) 또는 ordinance (자치법규, AABBCC)")
})
```

#### 응답 형식 개선
```typescript
{
  "input": "제1조",
  "output": "010000",
  "direction": "to_code",
  "lawType": "ordinance",
  "format": "AABBCC (AA=조문, BB=의X, CC=서브)"
}
```

### 3. **docs/API.md** - 문서 업데이트
- 법령체계별 코드 형식 설명 추가
- 자치법규 변환 예제 7개 추가
- 응답 형식에 `lawType`, `format` 필드 추가

---

## 📖 LexDiff 참조 코드

### 분석한 파일
1. **lib/law-parser.ts** (lines 74-246)
   - `buildJO()`: 법령용 6자리 변환
   - `formatSimpleJo(jo, isOrdinance)`: 범용 변환 함수

2. **lib/ordin-parser.ts** (lines 142-234)
   - 자치법규용 AABBCC 형식 변환
   - 법령 형식 → 조례 형식 자동 변환 로직

3. **lib/admrul-parser.ts**
   - 행정규칙은 조코드 미사용 확인

---

## ✅ 테스트 결과

### 빌드 성공
```bash
npm run build
# ✓ Build completed successfully (no TypeScript errors)
```

### 예상 동작

#### 법률 변환
```javascript
parseJoCode({ joText: "제38조", direction: "to_code", lawType: "law" })
// → { output: "003800", format: "AAAABB (AAAA=조문, BB=의X)" }
```

#### 자치법규 변환
```javascript
parseJoCode({ joText: "제1조의1", direction: "to_code", lawType: "ordinance" })
// → { output: "010100", format: "AABBCC (AA=조문, BB=의X, CC=서브)" }

parseJoCode({ joText: "010100", direction: "to_text", lawType: "ordinance" })
// → { output: "제1조의1" }
```

#### 레거시 8자리 변환
```javascript
parseJoCode({ joText: "00380001", direction: "to_text" })
// → { output: "제38조-1" }
```

---

## 🎯 주요 개선사항

### 1. **완전한 법령체계 지원**
- ✅ 법률/시행령/시행규칙 (AAAABB)
- ✅ 자치법규 (AABBCC)
- ✅ 레거시 8자리 (AAAABBCC)
- ✅ 행정규칙 (문자열)

### 2. **하위 호환성 유지**
- 기존 `buildJO()`, `formatJO()` 함수 동작 변경 없음
- `lawType` 파라미터 기본값 `"law"`로 기존 동작 보장

### 3. **명확한 API 설계**
- `lawType` 파라미터로 법령 유형 명시
- 응답에 `format` 필드 추가로 사용 형식 명확화

---

## 📝 향후 개선 가능 사항

1. **자동 법령 유형 감지**
   - 조코드 길이/패턴으로 `lawType` 자동 추론
   - 예: `010000` → 자동으로 ordinance 인식

2. **조례별 조코드 검증**
   - 조례는 조문번호 99조 이하인지 검증
   - 법률은 조문번호 9999조 이하인지 검증

3. **에러 메시지 개선**
   - 법령 유형별 맞춤 에러 메시지
   - 예: "자치법규는 99조까지만 지원됩니다"

---

## 🔗 관련 파일

### 수정된 파일
- [src/lib/law-parser.ts](src/lib/law-parser.ts) (lines 67-156)
- [src/tools/utils.ts](src/tools/utils.ts) (lines 1-59)
- [docs/API.md](docs/API.md) (lines 322-415)

### 참조 파일 (LexDiff)
- `c:\github_project\lexdiff\lib\law-parser.ts`
- `c:\github_project\lexdiff\lib\ordin-parser.ts`
- `c:\github_project\lexdiff\lib\admrul-parser.ts`

---

**작성자**: Claude Sonnet 4.5
**업데이트**: 2025-12-20 22:30 KST
