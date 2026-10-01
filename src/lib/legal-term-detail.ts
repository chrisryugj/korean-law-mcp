import { cleanHtml } from "./article-parser.js"
import { extractTag } from "./xml-parser.js"

/** lstrm details repeat flat fields; each serial number starts a new record. */
export function parseLegalTermDetails(xml: string) {
  return xml.split(/(?=<법령용어일련번호>)/).map(record => ({
    name: cleanHtml(extractTag(record, "법령용어명_한글") || extractTag(record, "법령용어명")),
    hanja: cleanHtml(extractTag(record, "법령용어명_한자")),
    definition: cleanHtml(extractTag(record, "법령용어정의")),
    source: cleanHtml(extractTag(record, "출처")),
    code: cleanHtml(extractTag(record, "법령용어코드명")),
  })).filter(record => record.name || record.definition)
}
