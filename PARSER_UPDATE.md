# Law API Response Parser Update

## Summary

Updated `src/tools/law-text.ts` to correctly parse the Korean Law API JSON response structure based on the proven implementation from the LexDiff project.

## Problem

The original parser was not correctly extracting article content from the law API responses, particularly:
- Incorrect JSON path for article units
- Missing handling of nested `항` (paragraphs) array structure
- Incomplete extraction of `호` (items) and `목` (sub-items)
- Missing proper handling of nested array content

## Solution

Applied the parsing logic from LexDiff's `lib/law-json-parser.ts`, which correctly handles:

### 1. Correct JSON Structure Path

```typescript
// Correct: 법령.조문.조문단위[]
const lawData = json?.법령
const articleUnits = lawData.조문?.조문단위 || []
```

### 2. Proper Content Extraction

**Two-step content extraction:**

#### Step 1: Main Content (`조문내용`)
- Can be a string or nested array `[[...]]`
- Requires flattening nested arrays
- Excludes `<img>` tags while preserving other HTML

#### Step 2: Paragraph Content (`항` array)
- Extracts `항내용` from each paragraph
- Recursively processes:
  - `호` (items) → `호내용`
  - `목` (sub-items) → `목내용`

### 3. Content Combination

```typescript
// Combine main content + paragraph content
let finalContent = ""
if (mainContent) {
  finalContent = mainContent
  if (paraContent) {
    finalContent += "\n" + paraContent
  }
} else {
  finalContent = paraContent
}
```

## Key Functions Added

### `flattenContent(value: any): string`
- Flattens nested arrays into single string
- Filters out `<img>` tags
- Preserves table borders and other HTML

### `extractHangContent(hangArray: any[]): string`
- Recursively extracts content from paragraph structure
- Handles nested 호 (items) and 목 (sub-items)
- Combines all content with proper line breaks

### `cleanHtml(text: string): string`
- Removes all HTML tags
- Converts HTML entities (`&nbsp;`, `&lt;`, etc.)
- Trims whitespace

## API Response Structure

```json
{
  "법령": {
    "기본정보": {
      "법령명_한글": "관세법",
      "공포일자": "19490730",
      "시행일자": "20250101"
    },
    "조문": {
      "조문단위": [
        {
          "조문여부": "조문",
          "조문번호": "38",
          "조문가지번호": "0",
          "조문제목": "신고납부",
          "조문내용": "제38조(신고납부)...",
          "항": [
            {
              "항내용": "세관장에게 신고하고...",
              "호": [
                {
                  "호내용": "수입신고 사항",
                  "목": [
                    {
                      "목내용": "세부 항목"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

## Files Modified

- `src/tools/law-text.ts` (lines 50-212)

## Reference

Based on LexDiff project implementation:
- `c:\github_project\lexdiff\lib\law-json-parser.ts` (lines 93-223)
- `c:\github_project\lexdiff\app\api\eflaw\route.ts` (API endpoint)

## Testing

Build successful with no TypeScript errors:
```bash
npm run build
# ✓ Build completed successfully
```

## Result

The parser now correctly extracts:
- Law metadata (name, promulgation date, effective date)
- Article numbers and titles
- Full article content from both `조문내용` and `항` arrays
- Nested items (`호`) and sub-items (`목`)
- Clean, properly formatted text output

---

**Date:** 2025-12-19
**Updated by:** Claude Sonnet 4.5
