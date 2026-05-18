import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })

export type LawApiProtocol = "http" | "https"

const DEFAULT_LAW_API_PROTOCOL: LawApiProtocol = "https"

export function getLawApiProtocol(): LawApiProtocol {
  const raw = (process.env.LAW_API_PROTOCOL || "").trim().toLowerCase()
  if (raw === "http" || raw === "https") return raw
  return DEFAULT_LAW_API_PROTOCOL
}

export function getLawApiBaseUrl(): string {
  return `${getLawApiProtocol()}://www.law.go.kr/DRF`
}

export function getLawSiteBaseUrl(): string {
  return `${getLawApiProtocol()}://www.law.go.kr`
}
