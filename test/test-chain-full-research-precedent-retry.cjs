#!/usr/bin/env node

const assert = require("assert")

const QUERY = "중고거래 옷 구매자 단순 변심 환불 의무"
const PHOTO_QUERY = "공원에서 풍경 사진을 찍어서 SNS에 올리려고 하는데 사진 구석에 모르는 사람 얼굴이 작게 찍혀 있었다면, 제가 그 사람에게 일일이 허락을 받아야 하나요?"

function noLawXml() {
  return "<LawSearch><totalCnt>0</totalCnt><page>1</page></LawSearch>"
}

function lawSearchXml(lawName, lawId = "001504", mst = "272861") {
  return [
    "<LawSearch>",
    "<totalCnt>1</totalCnt>",
    "<page>1</page>",
    "<law>",
    `<법령명한글>${lawName}</법령명한글>`,
    `<법령ID>${lawId}</법령ID>`,
    `<법령일련번호>${mst}</법령일련번호>`,
    "<법령구분명>법률</법령구분명>",
    "</law>",
    "</LawSearch>",
  ].join("")
}

function lawTextJson(lawName) {
  return JSON.stringify({
    법령: {
      기본정보: {
        법령명_한글: lawName,
        공포일자: "20250101",
        시행일자: "20250101",
      },
      조문: {
        조문단위: [
          {
            조문여부: "조문",
            조문번호: "1",
            조문제목: "목적",
            조문내용: `제1조(${lawName}) 테스트 조문`,
          },
        ],
      },
    },
  })
}

function noAiLawXml() {
  return "<aiSearch><검색결과개수>0</검색결과개수><page>1</page></aiSearch>"
}

function privacyAiLawXml() {
  return [
    "<aiSearch>",
    "<검색결과개수>2</검색결과개수>",
    "<page>1</page>",
    "<법령조문>",
    "<법령명>정보통신망 이용촉진 및 정보보호 등에 관한 법률</법령명>",
    "<법령종류명>법률</법령종류명>",
    "<조문번호>0044</조문번호>",
    "<조문제목>사생활 침해</조문제목>",
    "<조문내용>이용자는 사생활 침해 또는 명예훼손 등 타인의 권리를 침해하는 정보를 정보통신망에 유통시켜서는 아니 된다.</조문내용>",
    "<시행일자>20251001</시행일자>",
    "</법령조문>",
    "<법령조문>",
    "<법령명>민법</법령명>",
    "<법령종류명>법률</법령종류명>",
    "<조문번호>0750</조문번호>",
    "<조문제목>불법행위의 내용</조문제목>",
    "<조문내용>고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자는 그 손해를 배상할 책임이 있다.</조문내용>",
    "<시행일자>20260101</시행일자>",
    "</법령조문>",
    "</aiSearch>",
  ].join("")
}

function manyAiLawXml() {
  return [
    "<aiSearch>",
    "<검색결과개수>6</검색결과개수>",
    "<page>1</page>",
    "<법령조문><법령명>민법</법령명><조문번호>0750</조문번호><조문제목>불법행위의 내용</조문제목><조문내용>테스트</조문내용><시행일자>20260101</시행일자></법령조문>",
    "<법령조문><법령명>민법</법령명><조문번호>0398</조문번호><조문제목>배상액의 예정</조문제목><조문내용>테스트</조문내용><시행일자>20260101</시행일자></법령조문>",
    "<법령조문><법령명>민법</법령명><조문번호>0543</조문번호><조문제목>해지 해제</조문제목><조문내용>테스트</조문내용><시행일자>20260101</시행일자></법령조문>",
    "<법령조문><법령명>근로기준법</법령명><조문번호>0023</조문번호><조문제목>해고 등의 제한</조문제목><조문내용>테스트</조문내용><시행일자>20260101</시행일자></법령조문>",
    "<법령조문><법령명>전자상거래 등에서의 소비자보호에 관한 법률</법령명><조문번호>0017</조문번호><조문제목>청약철회등</조문제목><조문내용>테스트</조문내용><시행일자>20260101</시행일자></법령조문>",
    "<법령조문><법령명>질서위반행위규제법</법령명><조문번호>0016</조문번호><조문제목>사전통지 및 의견 제출</조문제목><조문내용>테스트</조문내용><시행일자>20260101</시행일자></법령조문>",
    "</aiSearch>",
  ].join("")
}

function quotedLawNameAiLawXml() {
  return [
    "<aiSearch>",
    "<검색결과개수>1</검색결과개수>",
    "<page>1</page>",
    "<법령조문>",
    "<법령명>콘텐츠산업 진흥법</법령명>",
    "<법령종류명>법률</법령종류명>",
    "<조문번호>0027</조문번호>",
    "<조문제목>청약철회 등</조문제목>",
    "<조문내용>콘텐츠제작자는 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 청약철회 및 계약의 해제가 불가능한 경우를 표시하여야 한다.</조문내용>",
    "<시행일자>20251001</시행일자>",
    "</법령조문>",
    "</aiSearch>",
  ].join("")
}

function genericContractAiLawXml() {
  return [
    "<aiSearch>",
    "<검색결과개수>1</검색결과개수>",
    "<page>1</page>",
    "<법령조문>",
    "<법령명>전자상거래 등에서의 소비자보호에 관한 법률</법령명>",
    "<법령종류명>법률</법령종류명>",
    "<조문번호>0017</조문번호>",
    "<조문제목>청약철회등</조문제목>",
    "<조문내용>통신판매업자와 재화등의 구매에 관한 계약을 체결한 소비자는 기간 이내에 해당 계약에 관한 청약철회등을 할 수 있다.</조문내용>",
    "<시행일자>20260120</시행일자>",
    "</법령조문>",
    "</aiSearch>",
  ].join("")
}

function extendedIssueAiLawXml() {
  return [
    "<aiSearch>",
    "<검색결과개수>1</검색결과개수>",
    "<page>1</page>",
    "<법령조문>",
    "<법령명>고용정책 기본법</법령명>",
    "<법령종류명>법률</법령종류명>",
    "<조문번호>0007</조문번호>",
    "<조문제목>취업기회의 균등한 보장</조문제목>",
    "<조문내용>사업주는 모집과 채용에서 고용 차별이 발생하지 않도록 하여야 한다.</조문내용>",
    "<시행일자>20260101</시행일자>",
    "</법령조문>",
    "</aiSearch>",
  ].join("")
}

function noInterpretationXml() {
  return "<Expc><totalCnt>0</totalCnt><page>1</page></Expc>"
}

function noPrecedentXml() {
  return "<PrecSearch><totalCnt>0</totalCnt><page>1</page></PrecSearch>"
}

function precedentXml() {
  return [
    "<PrecSearch>",
    "<totalCnt>1</totalCnt>",
    "<page>1</page>",
    "<prec>",
    "<판례일련번호>12345</판례일련번호>",
    "<사건명>중고거래 물품대금 반환 사건</사건명>",
    "<사건번호>2024가단12345</사건번호>",
    "<법원명>서울중앙지방법원</법원명>",
    "<선고일자>20240101</선고일자>",
    "<판결유형>판결</판결유형>",
    "<판례상세링크>https://example.test/prec/12345</판례상세링크>",
    "</prec>",
    "</PrecSearch>",
  ].join("")
}

function makeApiClient({ succeedOnQuery, aiLawXml = noAiLawXml(), lawXml = noLawXml() }) {
  const precedentQueries = []
  const lawTextRequests = []
  return {
    precedentQueries,
    lawTextRequests,
    async searchLaw() {
      return lawXml
    },
    async getLawText(request) {
      lawTextRequests.push(request)
      return lawTextJson("가축전염병 예방법")
    },
    async fetchApi(request) {
      if (request.target === "aiSearch") return aiLawXml
      if (request.target === "expc") return noInterpretationXml()
      if (request.target === "prec") {
        const query = String(request.extraParams?.query || "")
        precedentQueries.push(query)
        return query === succeedOnQuery ? precedentXml() : noPrecedentXml()
      }
      throw new Error(`unexpected target: ${request.target}`)
    },
  }
}

async function testUsesAiLawIssueBeforeRawFirstWord(chainFullResearch) {
  const apiClient = makeApiClient({
    succeedOnQuery: "사생활 침해",
    aiLawXml: privacyAiLawXml(),
  })

  const result = await chainFullResearch(apiClient, { query: PHOTO_QUERY, apiKey: "test" })
  const text = result.content?.[0]?.text || ""

  assert.deepStrictEqual(apiClient.precedentQueries.slice(0, 2), [PHOTO_QUERY, "사생활 침해"])
  assert.ok(!apiClient.precedentQueries.includes("공원에서"), apiClient.precedentQueries.join(", "))
  assert.ok(text.includes('재검색어 "사생활 침해"'), text)
  assert.ok(text.includes("중고거래 물품대금 반환 사건"), text)
}

async function testRetriesSuggestedKeywordAfterRawPrecedentFailure(chainFullResearch) {
  const apiClient = makeApiClient({ succeedOnQuery: "중고거래" })

  const result = await chainFullResearch(apiClient, { query: QUERY, apiKey: "test" })
  const text = result.content?.[0]?.text || ""

  assert.deepStrictEqual(apiClient.precedentQueries.slice(0, 2), [QUERY, "중고거래"])
  assert.ok(text.includes("판례 1차 검색 실패 후 재검색어 \"중고거래\""), text)
  assert.ok(text.includes("중고거래 물품대금 반환 사건"), text)
}

async function testIgnoresQuotedLawNameFragments(chainFullResearch) {
  const apiClient = makeApiClient({
    succeedOnQuery: "청약철회",
    aiLawXml: quotedLawNameAiLawXml(),
  })

  const result = await chainFullResearch(apiClient, { query: QUERY, apiKey: "test" })
  const text = result.content?.[0]?.text || ""

  assert.deepStrictEqual(apiClient.precedentQueries.slice(0, 2), [QUERY, "청약철회"])
  assert.ok(!apiClient.precedentQueries.includes("소비자보호"), apiClient.precedentQueries.join(", "))
  assert.ok(text.includes("판례 1차 검색 실패 후 재검색어 \"청약철회\""), text)
}

async function testIgnoresGenericContractPhrase(chainFullResearch) {
  const apiClient = makeApiClient({
    succeedOnQuery: "청약철회",
    aiLawXml: genericContractAiLawXml(),
  })

  const result = await chainFullResearch(apiClient, { query: QUERY, apiKey: "test" })
  const text = result.content?.[0]?.text || ""

  assert.deepStrictEqual(apiClient.precedentQueries.slice(0, 2), [QUERY, "청약철회"])
  assert.ok(!apiClient.precedentQueries.includes("관한 계약"), apiClient.precedentQueries.join(", "))
  assert.ok(text.includes("판례 1차 검색 실패 후 재검색어 \"청약철회\""), text)
}

async function testUsesAiLawArticleTitleCandidate(chainFullResearch) {
  const apiClient = makeApiClient({
    succeedOnQuery: "취업기회의 균등한 보장",
    aiLawXml: extendedIssueAiLawXml(),
  })

  const result = await chainFullResearch(apiClient, {
    query: "채용 과정에서 불합리한 대우를 받았습니다",
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.deepStrictEqual(apiClient.precedentQueries.slice(0, 2), [
    "채용 과정에서 불합리한 대우를 받았습니다",
    "취업기회의 균등한 보장",
  ])
  assert.ok(text.includes("판례 1차 검색 실패 후 재검색어 \"취업기회의 균등한 보장\""), text)
}

async function testUsesLowConfidenceLawTextFallback(chainFullResearch) {
  const apiClient = makeApiClient({
    succeedOnQuery: "청약철회",
    aiLawXml: genericContractAiLawXml(),
    lawXml: lawSearchXml("가축전염병 예방법"),
  })

  const result = await chainFullResearch(apiClient, {
    query: "중고거래로 옷을 판매했는데, 구매자가 색깔 불만으로 환불을 요구할 경우 판매자의 법적 의무와 대응 방법",
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.strictEqual(apiClient.lawTextRequests.length, 1)
  assert.ok(text.includes("▶ 가축전염병 예방법 본문 (관련도 낮음)"), text)
}

async function testKeepsExplicitLawText(chainFullResearch) {
  const apiClient = makeApiClient({
    succeedOnQuery: "__never__",
    lawXml: lawSearchXml("민법", "001706", "267305"),
  })

  const result = await chainFullResearch(apiClient, {
    query: "민법 제750조 불법행위 손해배상",
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.strictEqual(apiClient.lawTextRequests.length, 1)
  assert.ok(text.includes("▶ 민법 본문"), text)
}

async function testLimitsPrecedentRetriesToFive(chainFullResearch) {
  const apiClient = makeApiClient({
    succeedOnQuery: "__never__",
    aiLawXml: manyAiLawXml(),
  })

  await chainFullResearch(apiClient, {
    query: "가나다 라마바 사아자 차카타 파하 환불 의무",
    apiKey: "test",
  })

  assert.strictEqual(
    apiClient.precedentQueries.length,
    6,
    `expected raw precedent search plus five retries, got ${apiClient.precedentQueries.length}: ${apiClient.precedentQueries.join(", ")}`
  )
}

async function main() {
  const { chainFullResearch } = await import("../build/tools/chains.js")
  await testUsesAiLawIssueBeforeRawFirstWord(chainFullResearch)
  await testRetriesSuggestedKeywordAfterRawPrecedentFailure(chainFullResearch)
  await testIgnoresQuotedLawNameFragments(chainFullResearch)
  await testIgnoresGenericContractPhrase(chainFullResearch)
  await testUsesAiLawArticleTitleCandidate(chainFullResearch)
  await testUsesLowConfidenceLawTextFallback(chainFullResearch)
  await testKeepsExplicitLawText(chainFullResearch)
  await testLimitsPrecedentRetriesToFive(chainFullResearch)
  console.log("chain_full_research precedent retry tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
