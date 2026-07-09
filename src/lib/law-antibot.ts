/**
 * law.go.kr JS 안티봇 우회 (클라우드 IP 대응)
 *
 * 법제처는 클라우드 IP(GCP/AWS/Fly 등)에서 온 요청에 API 데이터 대신
 * `location.assign(...)` JS 리다이렉트 페이지를 반환할 때가 있다. 이 페이지의
 * 난독화된 URL을 파싱해 토큰 URL로 재요청하면 우회된다.
 * (LexLink-ko-mcp client.py의 `_follow_antibot` 접근을 이식)
 *
 * 로컬/등록 IP에서는 이 페이지가 오지 않으므로 평상시엔 no-op이다. Fly 등
 * 클라우드 배포에서 UA/Referer만으로 뚫리지 않는 경우의 방어층.
 *
 * 한계: Node fetch(undici)는 쿠키 jar가 없어 "안티봇 홉이 심은 세션 쿠키로
 * 원본 재시도 성공" 경로는 제한적이다. 주 경로는 토큰 URL 직접 파싱이다.
 */

/**
 * 안티봇 JS의 두 난독화 패턴에서 리다이렉트 경로를 복원한다.
 *
 * - 패턴 A(concat): `x={t:'..',h:'..',o:'..'}; return x.t+x.h+x.o`
 * - 패턴 B(substr): `x={o:'..',c:N},z=M; return o.substr(0,c)+o.substr(c+z)`
 */
export function parseAntibotUrl(html: string): string | null {
  // 패턴 A: 3분할 concat (t + h + o)
  const a = html.match(/t:'([^']*)',h:'([^']*)'/)
  if (a) {
    const o = html.match(/o:'([^']*)'/)
    if (o) return a[1] + a[2] + o[1]
  }

  // 패턴 B: substring 슬라이싱
  const b = html.match(/o:'([^']*)',c:(\d+)},z=(\d+)/)
  if (b) {
    const o = b[1]
    const c = Number(b[2])
    const z = Number(b[3])
    return o.slice(0, c) + o.slice(c + z)
  }

  return null
}

/** timeout이 걸린 단발 fetch */
async function fetchOnce(url: string, headers: Headers, timeout: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { headers, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 응답이 JS 안티봇 페이지면 우회한 새 Response를, 아니면 null(원본 유지)을 반환.
 * 최대 maxHops까지 location.assign 리다이렉트를 추적한다.
 */
export async function followLawAntibot(
  response: Response,
  originalUrl: string,
  headers: Headers,
  timeout: number,
  maxHops = 3
): Promise<Response | null> {
  let current = response
  let hopped = false

  for (let hop = 0; hop < maxHops; hop++) {
    let text: string
    try {
      text = await current.clone().text()
    } catch {
      return hopped ? current : null
    }

    // 안티봇 페이지가 아니면 종료 (첫 홉이면 변경 없음 = null)
    if (!text.includes("location.assign")) {
      return hopped ? current : null
    }

    const path = parseAntibotUrl(text)
    if (!path) return hopped ? current : null

    // path는 보통 절대경로(/DRF/...). 원본 URL의 origin에 붙인다.
    let nextUrl: string
    try {
      nextUrl = new URL(path, originalUrl).toString()
    } catch {
      return hopped ? current : null
    }

    const next = await fetchOnce(nextUrl, headers, timeout)
    hopped = true

    // 토큰 URL이 404면 원본을 한 번 더 시도 (홉이 세션을 세팅했을 수 있음)
    if (next.status === 404) {
      return await fetchOnce(originalUrl, headers, timeout)
    }

    current = next
  }

  return current
}
