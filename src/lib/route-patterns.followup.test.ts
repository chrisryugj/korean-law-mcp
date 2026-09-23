/**
 * 라우팅 후속 결함 회귀 테스트 (#119 #120 #121 #122 #123)
 *
 * 규칙 통합(#99~#104) 이후 남은 선존재 결함 + 통합이 드러낸 구조 문제.
 */
import { describe, it, expect } from "vitest"
import { z } from "zod"
import { routeQuery } from "./query-router.js"
import { sortedRoutePatterns } from "./route-patterns.js"
import { SEARCH_DETAIL_CHAINS } from "./tool-chain-config.js"
import { allTools } from "../tool-registry.js"

function reached(query: string): string[] {
  const r = routeQuery(query)
  return [r.tool, ...(r.pipeline ?? []).map(p => p.tool)]
}

function mainQuery(query: string): unknown {
  return routeQuery(query).params.query
}

describe("#119 검색계 추출이 검색어를 훼손하지 않는다", () => {
  it("빈 검색어를 업스트림으로 보내지 않는다", () => {
    // "관세 해석" 은 트리거 어휘가 곧 쿼리 전부 — 지우고 나면 빈 문자열이 남았다
    for (const q of ["관세 해석", "해석례", "판례", "행정심판", "조세 심판", "통합 검색"]) {
      const r = routeQuery(q)
      const v = r.params.query
      if (typeof v === "string") {
        expect([q, v.trim().length > 0]).toEqual([q, true])
      }
    }
  })

  it("트리거 어휘가 공백을 포함해도 반쪽만 남지 않는다", () => {
    expect(mainQuery("유권 해석 근로시간")).toBe("근로시간")
    expect(mainQuery("조세 심판 부가세")).toBe("부가세")
    expect(mainQuery("공정거래 위원회 담합")).toBe("담합")
    expect(mainQuery("개인정보 보호 위원회 유출")).toBe("유출")
    expect(mainQuery("노동 위원회 부당해고")).toBe("부당해고")
    expect(mainQuery("통합 검색 음주운전")).toBe("음주운전")
  })

  it("어휘를 절단하지 않는다 ('선의' → '선')", () => {
    expect(mainQuery("법령 용어 선의")).toBe("선의")
  })
})

describe("#119 트리거 제거가 낱말을 자르지 않는다", () => {
  it("탐지 어휘가 낱말 일부여도 그 낱말을 자르지 않는다", () => {
    // 탐지는 부분 일치를 허용하지만(`대법원\s*판`, `위헌`) 제거는 낱말 경계를 지켜야 한다
    expect(mainQuery("대법원 판단 기준 알려줘")).toBe("판단 기준 알려줘")
    expect(mainQuery("위헌성 심사 기준")).toBe("위헌성 심사 기준")
    expect(mainQuery("행정심판 사례 분석")).toBe("사례 분석")
    expect(mainQuery("행정심판 비례원칙")).toBe("비례원칙")
    expect(mainQuery("행정심판 선례 조사")).toBe("선례 조사")
  })

  it("트리거만 남은 질의는 한 음절 잔재가 아니라 원문으로 돌아간다", () => {
    expect(mainQuery("헌법재판소 결정")).toBe("헌법재판소 결정")
    expect(mainQuery("중앙노동위원회 결정문")).toBe("중앙노동위원회 결정문")
  })
})

describe("#122 applicable_law 파라미터 정합", () => {
  it("'무렵' 계열 수식어가 법령명에 섞이지 않는다", () => {
    for (const q of [
      "2023년 5월 10일 무렵 도로교통법 제44조",
      "2023년 5월 10일 무렵에 시행되던 도로교통법 제44조 당시 적용",
    ]) {
      expect([q, routeQuery(q).params.lawName]).toEqual([q, "도로교통법"])
    }
  })
})

describe("판정 규약 동기화 — 연도 필터는 충족 요건이다 (12 문서 R37 재정)", () => {
  it("'YYYY년' 단독 시점이 기간 필터로 추출된다", () => {
    const r = routeQuery("관세법 판례 2024년이랑 비교해줘")
    expect([r.dateRange?.from, r.dateRange?.to]).toEqual(["20240101", "20241231"])
  })

  it("두 시점 비교의 연도는 삼키지 않는다 — time_travel 이 뽑은 값을 덮어쓰면 안 된다", () => {
    for (const q of ["관세법 2024년과 2025년 차이", "2020년부터 2023년까지 관세법 개정 이력"]) {
      const r = routeQuery(q)
      // 두 시점이 파라미터로 살아 있어야 한다
      expect([q, r.params.fromDate, r.params.toDate]).toEqual([q, expect.any(String), expect.any(String)])
    }
    expect(routeQuery("관세법 2024년과 2025년 차이").dateRange).toBeUndefined()
  })
})

describe("#129 '판례'가 심판례 합성어를 가로채지 않는다", () => {
  it("행정심판례 질의는 행정심판 검색으로 간다", () => {
    expect(reached("행정심판례 건축허가")).toContain("search_admin_appeals")
  })

  it("조세심판례 질의는 조세심판 검색으로 간다", () => {
    expect(reached("조세심판례 부가세")).toContain("search_tax_tribunal_decisions")
  })

  it("일반 판례 질의는 그대로 판례 검색이다", () => {
    expect(reached("건축허가 거부 판례")).toContain("search_precedents")
    expect(reached("음주운전 무죄 판례 있어?")).toContain("search_precedents")
  })
})

describe("#130 조문 동반 별표 질의", () => {
  it("별표 어휘가 있으면 조문이 함께 와도 별표 경로가 이긴다", () => {
    expect(reached("관세법 제38조 별표 2")).toContain("get_annexes")
  })

  it("법령명과 별표번호가 각각 전달된다", () => {
    const p = routeQuery("관세법 제38조 별표 2").params
    expect([p.lawName, p.annexNo]).toEqual(["관세법", "2"])
  })

  it("조문번호가 별표번호로 잘못 들어가지 않는다", () => {
    expect(routeQuery("관세법 제38조 별표 2").params.annexNo).not.toBe("38")
  })

  it("별표 단독형은 기존대로다", () => {
    const p = routeQuery("도로교통법 시행규칙 별표28").params
    expect([p.lawName, p.annexNo]).toEqual(["도로교통법 시행규칙", "28"])
  })

  it("조문값을 jo 로 함께 싣는다 (#133 배선 준비)", () => {
    expect(routeQuery("관세법 제38조 별표 2").params.jo).toBe("제38조")
  })

  it("get_annexes 가 jo 를 열면 그 값이 스키마를 통과한다", () => {
    // #133 이 병합되기 전에는 Zod 가 조용히 버리므로 이 단언은 자동으로 건너뛴다.
    // 병합되는 순간 스스로 활성화된다 — 수동 토글이 없다.
    const tool = allTools.find(t => t.name === "get_annexes")
    const shape = tool?.schema instanceof z.ZodObject ? tool.schema.shape : undefined
    if (!shape || !("jo" in shape)) return
    const parsed = tool!.schema.parse(routeQuery("관세법 제38조 별표 2").params)
    expect((parsed as { jo?: string }).jo).toBe("제38조")
  })
})

describe("#123 가드 구조의 안전장치", () => {
  it("패턴 이름이 겹쳐도 가드가 한쪽만 보지 않는다", () => {
    // scenario_action_plan 은 두 단계로 선언된다 — 이름 충돌이 조용히 덮어쓰기가 되면 안 된다
    const names = sortedRoutePatterns.map(p => p.name)
    const dupes = names.filter((n, i) => names.indexOf(n) !== i)
    for (const d of new Set(dupes)) {
      expect([d, sortedRoutePatterns.filter(p => p.name === d).length > 1]).toEqual([d, true])
    }
  })

  it("수신 패턴이 실제로 받아 가지 않으면 양보하지 않는다", () => {
    // applicable_law 는 정규식이 맞아도 날짜가 없으면 _fallback — 양보하면 조문 의도까지 잃는다
    expect(reached("민법 제38조 당시 시행")).toContain("get_law_text")
  })
})

describe("#120 full 미지원 도구에서 의도가 무음 소멸하지 않는다", () => {
  it("supportsFull 선언이 실제 스키마와 어긋나지 않는다", () => {
    for (const [search, chain] of Object.entries(SEARCH_DETAIL_CHAINS)) {
      const tool = allTools.find(t => t.name === chain.detailTool)
      const shape = tool?.schema instanceof z.ZodObject ? tool.schema.shape : undefined
      const actual = !!shape && "full" in shape
      expect([search, chain.supportsFull === true]).toEqual([search, actual])
    }
  })

  it("full 을 받는 상세도구에는 전달된다", () => {
    const r = routeQuery("대법원 2022도6643 판결 전문 보여줘")
    expect(JSON.stringify(r.pipeline)).toContain("\"full\":true")
  })

  it("full 을 받지 못하는 상세도구면 경고 표면화를 위해 표시를 남긴다", () => {
    // 자치법규 상세(get_ordinance)는 full 을 받지 않는다
    const r = routeQuery("서울시 주차 조례 전문 보여줘")
    expect(r.unsupportedParams).toContain("full")
  })
})

describe("#121 대형 입력에서 라우팅이 선형 시간에 가깝다", () => {
  it("8k자 입력이 100ms 안에 끝난다", () => {
    const q = "광진구 " + "가나다라마바사아자차카타파하 ".repeat(600)
    const t = Date.now()
    routeQuery(q)
    expect([q.length, Date.now() - t < 100]).toEqual([q.length, true])
  })

  it("길이를 4배로 늘려도 비용이 제곱으로 뛰지 않는다", () => {
    // O(n²) 였을 때 9k자 487ms / 36k자 7.6초. 선형이면 4배 길이에 4배 남짓이어야 한다.
    const build = (n: number) => "광진구 " + "가나다라마바사아자차카타파하 ".repeat(n)
    // 평균 대신 최솟값: 병렬 테스트 중 GC·스케줄링 스파이크 한 번이 평균을 밀어 올려 간헐 실패했다
    // (2026-09-23, 4회 중 1회). 최솟값은 잡음에 강하고, 선형 4배 대 제곱 16배를 가르는 기준 8배는 그대로 유효하다.
    const time = (s: string) => {
      let best = Infinity
      for (let i = 0; i < 7; i++) {
        const t = performance.now()
        routeQuery(s)
        best = Math.min(best, performance.now() - t)
      }
      return best
    }
    time(build(100)) // warm-up
    const a = time(build(600))
    const b = time(build(2400))
    const ratio = b / Math.max(a, 0.05)
    expect([`${a.toFixed(2)}ms→${b.toFixed(2)}ms (${ratio.toFixed(1)}x)`, ratio < 8])
      .toEqual([`${a.toFixed(2)}ms→${b.toFixed(2)}ms (${ratio.toFixed(1)}x)`, true])
  })

  it("체인 도구 query 스키마에 길이 상한이 있다", () => {
    for (const name of ["chain_full_research", "chain_action_basis", "chain_law_system"]) {
      const tool = allTools.find(t => t.name === name)
      const res = tool?.schema.safeParse({ query: "가".repeat(50_000) })
      expect([name, res?.success]).toEqual([name, false])
    }
  })
})

describe("#122 라우팅 어휘·우선순위 공백", () => {
  it("'바뀌었/달라졌' 이 개정 이력 경로로 간다", () => {
    expect(reached("도로교통법 언제 바뀌었어?")).toContain("chain_amendment_track")
    expect(reached("민법 뭐가 달라졌어")).toContain("chain_amendment_track")
  })

  it("cite_check 이 '키워드 → 사건번호' 역순도 잡는다", () => {
    expect(reached("이 판례 아직 유효해? 2013다61381")).toContain("cite_check")
    expect(JSON.stringify(routeQuery("이 판례 아직 유효해? 2013다61381").params)).toContain("2013다61381")
  })

  it("'무렵에' 시점 표현이 applicable_law 로 간다", () => {
    expect(reached("2023년 5월 10일 무렵에 시행되던 도로교통법 제44조 당시 적용"))
      .toContain("applicable_law")
  })

  it("상위법 저촉 질의가 조례비교(compliance) 경로로 간다", () => {
    const r = routeQuery("서울시 조례가 상위법에 저촉되나")
    expect([r.tool, r.params.scenario]).toEqual(["chain_ordinance_compare", "compliance"])
  })
})

describe("#123 양보 가드가 수신 패턴에서 파생된다", () => {
  it("수신 패턴에만 어휘를 추가해도 가드가 함께 넓어진다", () => {
    // 가드가 별도 복사본이면 이 조합에서 specific_article(pri 1)이 선점한다
    expect(reached("민법 제103조 신구대조")).toContain("chain_amendment_track")
    expect(reached("관세법 제38조 위임 조문")).toContain("chain_law_system")
  })

  it("기존 양보 동작은 그대로다", () => {
    expect(reached("민법 제103조 인용 검증해줘")).toContain("verify_citations")
    expect(reached("민법 제103조 인용한 판례 보여줘")).toContain("impact_map")
    expect(reached("2023.5.10 당시 도로교통법 제44조")).toContain("applicable_law")
    expect(reached("「민법」 제103조 알려줘")).toContain("get_law_text")
  })
})
