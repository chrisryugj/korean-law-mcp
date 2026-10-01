import { getEventListeners } from "node:events"
import { describe, expect, it } from "vitest"
import { raceDeadline, startChainDeadline } from "./chain-deadline.js"

describe("chain deadline listener lifecycle", () => {
  it("removes abort listeners after successful branches", async () => {
    const deadline = startChainDeadline(5_000)
    try {
      for (let i = 0; i < 20; i++) {
        expect(await raceDeadline(deadline, Promise.resolve(i))).toEqual({ ok: true, value: i })
        expect(getEventListeners(deadline.signal, "abort")).toHaveLength(0)
      }
    } finally { deadline.dispose() }
  })

  it("removes abort listeners after failed branches", async () => {
    const deadline = startChainDeadline(5_000)
    try {
      await expect(raceDeadline(deadline, Promise.reject(new Error("upstream failed")))).rejects.toThrow("upstream failed")
      expect(getEventListeners(deadline.signal, "abort")).toHaveLength(0)
    } finally { deadline.dispose() }
  })
})
