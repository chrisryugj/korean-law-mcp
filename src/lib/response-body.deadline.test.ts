import http from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import { fetchWithRetry } from "./fetch-with-retry.js"
import { readResponseText } from "./response-body.js"

describe("native fetch stream deadline cleanup", () => {
  it("closes a continuously streaming upstream connection when the body deadline expires", async () => {
    let streamed = false
    let resolveClosed: () => void = () => {}
    const closed = new Promise<void>(resolve => { resolveClosed = resolve })
    const server = http.createServer((_req, res) => {
      streamed = true
      res.writeHead(200, { "content-type": "application/xml" })
      res.write(`<Law>${"data".repeat(1_024)}`)
      const interval = setInterval(() => res.write("data"), 20)
      res.once("close", () => {
        clearInterval(interval)
        resolveClosed()
      })
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
      await expect(fetchWithRetry(url, { deadline: 500 }).then(readResponseText)).rejects.toThrow(/timeout/i)
      expect(streamed).toBe(true)
      await closed
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
