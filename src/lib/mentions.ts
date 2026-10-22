import type { CatalogBook } from '../data/catalog.ts'

export type Mention =
  | { kind: 'text'; value: string }
  | { kind: 'hash'; value: string }
  | { kind: 'book'; value: string; book: CatalogBook }

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const distinctive = new Set(['circe', 'sapiens', 'gilead', 'katabasis', 'intermezzo'])

export function mentions(text: string, books: CatalogBook[]): Mention[] {
  const titles = books
    .filter((book) => {
      const words = book.title.trim().split(/\s+/)
      if (words.length >= 2 && book.title.length >= 8) return true
      return words.length === 1 && distinctive.has(book.title.toLowerCase())
    })
    .sort((a, b) => b.title.length - a.title.length)
  const byTitle = new Map<string, CatalogBook>()
  for (const book of titles) {
    const key = book.title.toLowerCase()
    if (!byTitle.has(key)) byTitle.set(key, book)
  }
  const marks: { start: number; end: number; mention: Mention }[] = []
  const unique = [...byTitle.values()].sort((a, b) => b.title.length - a.title.length)
  if (unique.length > 0) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${unique.map((book) => escapeRegExp(book.title)).join('|')})(?![\\p{L}\\p{N}])`,
      'giu',
    )
    for (const match of text.matchAll(pattern)) {
      if (match.index == null) continue
      const book = byTitle.get(match[0].toLowerCase())
      if (!book) continue
      marks.push({
        start: match.index,
        end: match.index + match[0].length,
        mention: { kind: 'book', value: match[0], book },
      })
    }
  }
  for (const match of text.matchAll(/#[\p{L}\p{N}_]{2,40}/gu)) {
    if (match.index == null) continue
    const start = match.index
    const end = start + match[0].length
    if (marks.some((mark) => start < mark.end && end > mark.start)) continue
    marks.push({ start, end, mention: { kind: 'hash', value: match[0] } })
  }
  marks.sort((a, b) => a.start - b.start)
  const parts: Mention[] = []
  let cursor = 0
  for (const mark of marks) {
    if (mark.start < cursor) continue
    if (mark.start > cursor) parts.push({ kind: 'text', value: text.slice(cursor, mark.start) })
    parts.push(mark.mention)
    cursor = mark.end
  }
  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) })
  return parts
}
