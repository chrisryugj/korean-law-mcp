import { fieldText } from "./precedent-body.js"

/** Normalize string/array/#text JSON fields before decision rendering and compaction. */
export function decisionFields(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fieldText(value)]))
}
