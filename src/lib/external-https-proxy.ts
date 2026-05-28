import http from "node:http"
import net from "node:net"
import tls from "node:tls"

const DEFAULT_TIMEOUT = 30000

export interface ExternalHttpsProxyConfig {
  host: string
  port: number
  rejectUnauthorized: boolean
  proxyAuthorization?: string
}

export interface ExternalHttpsRequestOptions {
  method?: string
  headers?: Record<string, string> | Array<[string, string]> | Headers
  body?: string
  timeout?: number
}

export interface ExternalHttpsResponse {
  ok: boolean
  status: number
  headers: Record<string, string | string[] | undefined>
  text: string
}

export function getExternalHttpsProxyConfig(): ExternalHttpsProxyConfig | null {
  const raw = (process.env.LAW_EXTERNAL_HTTPS_PROXY || "").trim()
  if (!raw) return null

  let proxyUrl: URL
  try {
    proxyUrl = new URL(raw)
  } catch {
    throw new Error("LAW_EXTERNAL_HTTPS_PROXY must be an http:// proxy URL")
  }

  if (proxyUrl.protocol !== "http:" || !proxyUrl.hostname) {
    throw new Error("LAW_EXTERNAL_HTTPS_PROXY must be an http:// proxy URL")
  }

  const username = decodeURIComponent(proxyUrl.username || "")
  const password = decodeURIComponent(proxyUrl.password || "")
  const proxyAuthorization = username
    ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
    : undefined

  return {
    host: proxyUrl.hostname,
    port: proxyUrl.port ? Number(proxyUrl.port) : 80,
    rejectUnauthorized: process.env.LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED !== "0",
    proxyAuthorization,
  }
}

export async function requestExternalHttps(
  url: string,
  options: ExternalHttpsRequestOptions,
  config = getExternalHttpsProxyConfig()
): Promise<ExternalHttpsResponse> {
  if (!config) {
    throw new Error("LAW_EXTERNAL_HTTPS_PROXY is not configured")
  }

  const targetUrl = new URL(url)
  if (targetUrl.protocol !== "https:") {
    throw new Error("requestExternalHttps only supports https:// URLs")
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const headers = normalizeHeaders(options.headers)
  const body = options.body || ""
  if (body && !headers["content-length"]) {
    headers["content-length"] = String(Buffer.byteLength(body))
  }

  return new Promise((resolve, reject) => {
    const agent = new http.Agent({ keepAlive: false })
    ;(agent as any).createConnection = (_requestOptions: unknown, callback: (error: Error | null, socket?: tls.TLSSocket) => void) => {
      createProxyTlsSocket(targetUrl, config, timeout).then(
        (socket) => callback(null, socket),
        (error) => callback(error)
      )
    }

    const request = http.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port ? Number(targetUrl.port) : 443,
      method: options.method || "GET",
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers,
      agent,
      timeout,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on("end", () => {
        resolve({
          ok: response.statusCode ? response.statusCode >= 200 && response.statusCode < 300 : false,
          status: response.statusCode || 0,
          headers: response.headers,
          text: Buffer.concat(chunks).toString("utf8"),
        })
      })
    })

    request.on("timeout", () => {
      request.destroy(new Error(`External HTTPS request timeout after ${timeout}ms`))
    })
    request.on("error", reject)
    if (body) request.write(body)
    request.end()
  })
}

function normalizeHeaders(headers: ExternalHttpsRequestOptions["headers"]): Record<string, string> {
  const normalized: Record<string, string> = {}
  const input = new Headers(headers as any)
  input.forEach((value, key) => {
    normalized[key] = value
  })
  return normalized
}

function createProxyTlsSocket(
  targetUrl: URL,
  config: ExternalHttpsProxyConfig,
  timeout: number
): Promise<tls.TLSSocket> {
  const targetPort = targetUrl.port ? Number(targetUrl.port) : 443

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.host, port: config.port })
    let settled = false
    let pending = Buffer.alloc(0)

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error)
    }

    socket.setTimeout(timeout, () => {
      fail(new Error(`External HTTPS proxy CONNECT timeout after ${timeout}ms`))
    })

    socket.once("error", fail)
    socket.once("connect", () => {
      const lines = [
        `CONNECT ${targetUrl.hostname}:${targetPort} HTTP/1.1`,
        `Host: ${targetUrl.hostname}:${targetPort}`,
        "Proxy-Connection: Keep-Alive",
      ]
      if (config.proxyAuthorization) {
        lines.push(`Proxy-Authorization: ${config.proxyAuthorization}`)
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`)
    })

    socket.on("data", function onConnectData(chunk: Buffer) {
      pending = Buffer.concat([pending, chunk])
      const headerEnd = pending.indexOf("\r\n\r\n")
      if (headerEnd === -1) return

      socket.removeListener("data", onConnectData)
      const headerText = pending.subarray(0, headerEnd).toString("latin1")
      const rest = pending.subarray(headerEnd + 4)
      const status = Number(headerText.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] || 0)

      if (status !== 200) {
        fail(new Error(`External HTTPS proxy CONNECT failed with HTTP ${status || "unknown"}`))
        return
      }

      if (rest.length > 0) socket.unshift(rest)

      const secureSocket = tls.connect({
        socket,
        servername: targetUrl.hostname,
        rejectUnauthorized: config.rejectUnauthorized,
      })

      secureSocket.setTimeout(timeout, () => {
        secureSocket.destroy(new Error(`External HTTPS TLS timeout after ${timeout}ms`))
      })
      secureSocket.once("error", fail)
      secureSocket.once("secureConnect", () => {
        if (settled) return
        settled = true
        secureSocket.setTimeout(0)
        resolve(secureSocket)
      })
    })
  })
}
