/** 법령 JO 변환 경계. LexDiff 이식 buildJO는 자리수를 넘겨도 반환하므로 소비 전에 검증한다. */
import { buildJO } from "./law-parser.js"

export function lawJoCode(input: string): string {
  const code = /^\d{6}$/.test(input) ? input : buildJO(input)
  if (!/^\d{6}$/.test(code)) {
    throw new Error("조문 번호 범위를 벗어났습니다 (조번호 최대 9999, 가지번호 최대 99).")
  }
  return code
}
