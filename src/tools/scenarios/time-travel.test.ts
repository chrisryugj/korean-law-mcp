import { describe, it, expect } from "vitest"
import { pickVersion } from "./time-travel.js"

const v = (mst: string, efYd: string) => ({ mst, efYd, lawNm: "테스트법", ancNo: "1", ancYd: "", rrCls: "일부개정" })

describe("pickVersion — 시행일 빈 값 NaN 오염", () => {
  // 회귀: 필터는 efYd=""를 0으로 폴백해 통과시키는데 정렬은 parseInt("")=NaN을
  // 그대로 써서 비교자가 NaN을 반환 — 정렬이 비결정적이 되어 "해당 시점 시행 버전"이
  // 아닌 버전이 뽑힐 수 있었다.
  it("빈 efYd가 섞여도 기준일 이하 최대 시행일 버전을 뽑는다", () => {
    const versions = [v("A", "20200101"), v("B", ""), v("C", "20230101"), v("D", "20220601")]
    expect(pickVersion(versions, "20240101")?.mst).toBe("C")
  })

  it("빈 efYd만 있으면 그것이라도 반환 (기존 동작 유지)", () => {
    expect(pickVersion([v("B", "")], "20240101")?.mst).toBe("B")
  })

  it("기준일 이전 버전이 없으면 undefined", () => {
    expect(pickVersion([v("C", "20230101")], "20200101")).toBeUndefined()
  })
})
