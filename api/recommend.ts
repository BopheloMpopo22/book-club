// This file is the Vercel Edge Function. It stays self-contained so the
// deploy bundler does not have to pull in another TypeScript module.

type BookMatch = {
  id: string
  title: string
  authors: string[]
  year: number | null
  description: string
  coverUrl: string | null
  infoUrl: string
  why: string
}

type SourceBook = {
  title: string
  authors: string[]
  year: number | null
  coverUrl: string | null
  infoUrl: string
  summary: string
}

type BookGroup = {
  id: string
  label: string
  books: BookMatch[]
}

type SearchInput = {
  query: string
  genres: string[]
  tropes: string[]
  movies: string[]
  exclude: string[]
  facet: string
  sourceTitle: string
  sourceAuthor: string
  sourceSummary: string
}

type Candidate = BookMatch & { editions: number }

const USER_AGENT = 'FolioBookFinder/0.1 (book recommendation site)'
const THIS_YEAR = new Date().getFullYear()

const TROPE_QUERIES: Record<string, string> = {
  'Enemies to lovers': 'enemies to lovers romance novel',
  'Friends to lovers': 'friends to lovers romance novel',
  'Forced proximity': 'forced proximity romance novel',
  'Only one bed': 'only one bed romance novel',
  'Grumpy and sunshine': 'grumpy sunshine romance novel',
  'Morally grey': 'morally grey hero romance fantasy novel',
  'He falls first': 'he falls first romance novel',
  'Slow burn': 'slow burn romance novel',
  'Fake dating': 'fake dating romance novel',
  'Second chance': 'second chance romance novel',
  'Forbidden love': 'forbidden love romance novel',
  'Found family': 'found family novel',
  'Marriage of convenience': 'marriage of convenience romance novel',
  Rivals: 'rivals to lovers romance novel',
  'Touch her and die': 'touch her and die romance novel',
  'Who did this to you': 'who did this to you romance novel',
  'Academic rivals': 'academic rivals romance novel',
  'Workplace romance': 'workplace romance novel',
  'The job is the plot': 'career drives the plot novel',
  'Small town': 'small town romance novel',
  'Fated mates': 'fated mates romantasy novel',
  'Hockey romance': 'hockey romance novel',
  Billionaire: 'billionaire romance novel',
  'Age gap': 'age gap romance novel',
  Banter: 'banter romance novel',
  'Competent heroine': 'competent heroine novel',
  'Realistic hero': 'realistic flawed hero novel',
  'Secret identity': 'secret identity romance novel',
  Revenge: 'revenge romance novel',
  Redemption: 'redemption arc novel',
  'Dark academia': 'dark academia novel',
  Gothic: 'gothic romance novel',
  'Unreliable narrator': 'unreliable narrator thriller novel',
  'Chosen one': 'chosen one fantasy novel',
  'Obsessive love': 'obsessive love dark romance novel',
  'Quiet love': 'quiet character driven romance novel',
}

const hits = new Map<string, number[]>()

function readEnv(name: string): string {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.[name]?.trim() ?? ''
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function cleanList(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
}

function plain(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_#]+/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function publish(book: Candidate): BookMatch {
  return {
    id: book.id,
    title: book.title,
    authors: book.authors,
    year: book.year,
    description: book.description,
    coverUrl: book.coverUrl,
    infoUrl: book.infoUrl,
    why: book.why,
  }
}

function keep(book: Candidate): boolean {
  if (!book.coverUrl) return false
  if (book.title.length > 80) return false
  if (/[_]|novels\b|box ?set|omnibus|complete series/i.test(book.title)) return false
  if (book.year != null && book.year >= THIS_YEAR - 10) return true
  if (book.editions <= 1 && book.description.length < 80) return false
  return true
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function clip(value: string, max: number): string {
  const text = value.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trim()}…`
}

function limited(request: Request): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < 10 * 60 * 1000)
  if (recent.length >= 30) {
    hits.set(ip, recent)
    return true
  }
  recent.push(now)
  hits.set(ip, recent)
  return false
}

async function fetchJson(url: string, ms = 8000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function yearFrom(value: unknown): number | null {
  if (typeof value === 'number' && value > 1400 && value < 2200) return value
  if (typeof value !== 'string') return null
  const match = value.match(/\d{4}/)
  if (!match) return null
  const year = Number(match[0])
  return year > 1400 && year < 2200 ? year : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

async function searchGoogle(query: string, count = 8): Promise<Candidate[]> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(count),
    printType: 'books',
    langRestrict: 'en',
    orderBy: 'relevance',
  })
  const key = readEnv('GOOGLE_BOOKS_API_KEY')
  if (key) params.set('key', key)
  const data = asRecord(await fetchJson(`https://www.googleapis.com/books/v1/volumes?${params}`))
  const items = Array.isArray(data?.items) ? data.items : []
  const books: Candidate[] = []
  for (const item of items) {
    const record = asRecord(item)
    const info = asRecord(record?.volumeInfo)
    const title = typeof info?.title === 'string' ? info.title.trim() : ''
    const id = typeof record?.id === 'string' ? record.id : ''
    if (!title || !id) continue
    if (typeof info?.language === 'string' && info.language !== 'en') continue
    const authors = Array.isArray(info?.authors)
      ? info.authors.filter((author): author is string => typeof author === 'string').slice(0, 4)
      : []
    const images = asRecord(info?.imageLinks)
    const rawCover =
      (typeof images?.thumbnail === 'string' && images.thumbnail) ||
      (typeof images?.smallThumbnail === 'string' && images.smallThumbnail) ||
      ''
    const coverUrl = rawCover
      ? rawCover.replace('http://', 'https://').replace('&edge=curl', '')
      : `https://books.google.com/books/content?id=${id}&printsec=frontcover&img=1&zoom=1`
    const infoUrl =
      (typeof info?.infoLink === 'string' && info.infoLink) ||
      (typeof info?.canonicalVolumeLink === 'string' && info.canonicalVolumeLink) ||
      `https://books.google.com/books?id=${id}`
    books.push({
      id: `gb:${id}`,
      title: clip(title, 180),
      authors,
      year: yearFrom(info?.publishedDate),
      description: clip(plain(typeof info?.description === 'string' ? info.description : ''), 360),
      coverUrl,
      infoUrl,
      why: '',
      editions: 5,
    })
  }
  return books
}

async function searchOpenLibrary(query: string, count = 8): Promise<Candidate[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(count),
    language: 'eng',
    fields: 'key,title,author_name,first_publish_year,cover_i,isbn,edition_count,first_sentence',
  })
  const data = asRecord(await fetchJson(`https://openlibrary.org/search.json?${params}`))
  const docs = Array.isArray(data?.docs) ? data.docs : []
  const books: Candidate[] = []
  for (const doc of docs) {
    const record = asRecord(doc)
    const title = typeof record?.title === 'string' ? record.title.trim() : ''
    const key = typeof record?.key === 'string' ? record.key : ''
    if (!title || !key.startsWith('/works/')) continue
    const authors = Array.isArray(record?.author_name)
      ? record.author_name.filter((author): author is string => typeof author === 'string').slice(0, 4)
      : []
    const coverId = typeof record?.cover_i === 'number' ? record.cover_i : null
    const isbn = Array.isArray(record?.isbn)
      ? record.isbn.find((value): value is string => typeof value === 'string')
      : undefined
    const sentence = record?.first_sentence
    const firstSentence = Array.isArray(sentence)
      ? sentence.find((value): value is string => typeof value === 'string') ?? ''
      : typeof sentence === 'string'
        ? sentence
        : ''
    books.push({
      id: `ol:${key}`,
      title: clip(title, 180),
      authors,
      year: yearFrom(record?.first_publish_year),
      description: clip(plain(firstSentence), 360),
      coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null,
      infoUrl: isbn ? `https://openlibrary.org/isbn/${isbn}` : `https://openlibrary.org${key}`,
      why: '',
      editions: typeof record?.edition_count === 'number' ? record.edition_count : 1,
    })
  }
  return books
}

function dedupe(books: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>()
  for (const book of books) {
    const nameParts = book.authors[0]?.split(' ') ?? []
    const author = normalize(nameParts[nameParts.length - 1] ?? '')
    const key = `${normalize(book.title)}:${author}`
    const current = map.get(key)
    if (!current) {
      map.set(key, book)
      continue
    }
    const currentScore =
      Number(Boolean(current.coverUrl)) + Number(current.description.length > 40) + current.editions
    const nextScore = Number(Boolean(book.coverUrl)) + Number(book.description.length > 40) + book.editions
    if (nextScore > currentScore) map.set(key, book)
  }
  return [...map.values()]
}

async function attachDescriptions(books: Candidate[]): Promise<Candidate[]> {
  const targets = books.filter((book) => book.id.startsWith('ol:') && book.description.length < 40).slice(0, 8)
  await Promise.all(
    targets.map(async (book) => {
      const data = asRecord(await fetchJson(`https://openlibrary.org${book.id.slice(3)}.json`))
      const description = data?.description
      const text =
        typeof description === 'string'
          ? description
          : typeof asRecord(description)?.value === 'string'
            ? (asRecord(description)?.value as string)
            : ''
      if (text) book.description = clip(plain(text), 360)
    }),
  )
  return books
}

function fallbackQueries(input: SearchInput): string[] {
  const queries: string[] = []
  const text = [input.query, ...input.tropes, ...input.genres].join(' ').toLowerCase()
  if (/\b(law|lawyer|attorney|legal)\b/.test(text)) queries.push('lawyer romance novel')
  if (/\b(workplace|office|job|career|firm)\b/.test(text)) queries.push('workplace romance novel')
  if (/\bromance\b/.test(text)) queries.push('contemporary romance novel')
  for (const trope of input.tropes) queries.push(TROPE_QUERIES[trope] ?? `${trope} novel`)
  if (input.genres[0]) queries.push(`${input.genres[0]} novel`)
  for (const movie of input.movies) queries.push(`novels like the movie ${movie}`)
  if (queries.length === 0) queries.push('popular recent romance novel')
  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()))].slice(0, 3)
}

function synthesizeNote(input: SearchInput): string {
  if (input.query) return `For “${clip(input.query, 110)}”`
  const parts = [...input.tropes, ...input.genres, ...input.movies]
  if (parts.length) return `For ${parts.join(', ')}`
  return 'Closest matches'
}

function templateWhy(book: BookMatch, input: SearchInput): string {
  const sentences = book.description
    .split(/(?<=[.!])\s/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  const useful = sentences.find(
    (sentence) => sentence.length > 50 && !/bestseller|tiktok sensation|award-winning|new york times/i.test(sentence),
  )
  const sentence = useful ?? sentences.find((item) => item.length > 40) ?? ''
  if (sentence.length > 40 && sentence.length < 220) return sentence
  const hook = input.tropes[0] || input.movies[0] || input.genres[0] || 'the specific thing you described'
  const who = book.authors[0] ? `${book.authors[0]}'s ` : ''
  return `${who}${book.title} lines up with ${hook}.`
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  return JSON.parse(fenced?.[1] ?? trimmed)
}

async function askModel(
  system: string,
  user: string,
  options?: { timeoutMs?: number; temperature?: number },
): Promise<unknown> {
  const key = readEnv('OPENAI_API_KEY')
  if (!key) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 12000)
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: readEnv('OPENAI_MODEL') || 'gpt-4o-mini',
        temperature: options?.temperature ?? 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!response.ok) return null
    const data = asRecord(await response.json())
    const choices = Array.isArray(data?.choices) ? data.choices : []
    const message = asRecord(asRecord(choices[0])?.message)
    const content = typeof message?.content === 'string' ? message.content : ''
    if (!content) return null
    return parseJson(content)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function lastName(author: string): string {
  const parts = author.split(' ').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function titlesMatch(wanted: string, found: string): boolean {
  const core = (value: string) =>
    normalize(
      (value.split(/[:–—]/)[0] ?? value)
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\bbook\s+\d+\b/gi, ' ')
        .replace(/\b(a novel|novel)\b/gi, ''),
    )
  const left = core(wanted)
  const right = core(found)
  return left.length >= 4 && left === right
}

type TitlePick = { title: string; author: string; why: string }

type Plan =
  | { mode: 'list'; note: string; picks: TitlePick[] }
  | {
      mode: 'similar'
      source: { title: string; author: string; summary: string }
      groups: { label: string; picks: TitlePick[] }[]
    }

function parsePicks(value: unknown, limit: number): TitlePick[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item) => {
      const record = asRecord(item)
      const title = typeof record?.title === 'string' ? record.title.trim() : ''
      const author = typeof record?.author === 'string' ? record.author.trim() : ''
      const why = typeof record?.why === 'string' ? clip(record.why, 240) : ''
      return title && author && why ? [{ title, author, why }] : []
    })
    .slice(0, limit)
}

function newestFirst(books: Candidate[]): Candidate[] {
  return books.slice().sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
}

function parseGroups(value: unknown): { label: string; picks: TitlePick[] }[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item) => {
      const record = asRecord(item)
      const label = typeof record?.label === 'string' ? record.label.trim() : ''
      const picks = parsePicks(record?.books, 4)
      return label && picks.length ? [{ label, picks }] : []
    })
    .slice(0, 4)
}

function parseSimilar(data: Record<string, unknown> | null, fallback?: { title: string; author: string }): Plan | null {
  if (!data || data.mode !== 'similar') return null
  const source = asRecord(data.source)
  const title = (typeof source?.title === 'string' && source.title.trim()) || fallback?.title || ''
  const author = (typeof source?.author === 'string' && source.author.trim()) || fallback?.author || ''
  const summary = typeof source?.summary === 'string' ? clip(source.summary, 320) : ''
  const groups = parseGroups(data.groups).filter(
    (group) => !describesAnotherBook(`${group.label} ${group.picks.map((pick) => pick.why).join(' ')}`, author),
  )
  if (!title || !author || !summary || describesAnotherBook(summary, author) || groups.length === 0) return null
  return { mode: 'similar', source: { title, author, summary }, groups }
}

async function planRequest(input: SearchInput, matched?: Candidate | null): Promise<Plan | null> {
  const matchedNote = matched
    ? {
        title: matched.title,
        authors: matched.authors,
        year: matched.year,
        catalogDescription: matched.description,
      }
    : null
  const followUp = input.facet
    ? `The reader confirmed ${input.sourceTitle} by ${input.sourceAuthor}. Plot already established: ${input.sourceSummary || 'use only this author'}. They want more books only for this angle: ${input.facet}. Do not switch to a different novel that shares the title. Do not repeat: ${input.exclude.join('; ') || 'none'}. Return JSON {"mode":"list","note":"${input.facet}","books":[{"title":"","author":"","why":""}]} with 8 real books.`
    : input.exclude.length > 0
      ? `Give 12 more real novels for this request. Any publication year. Do not repeat: ${input.exclude.join('; ')}. Return JSON {"mode":"list","note":"one sentence","books":[{"title":"","author":"","why":""}]}.`
      : `Several different novels can share one title. Heartless by R.C. Martin is a contemporary romance. Heartless by Marissa Meyer is the Wonderland novel. Heartless by Elsie Silver and Heartless by Kat Martin are other books. Never describe one of them with another author's name. If matchedBook is present, that catalog record is the book. Use its author, year, and catalogDescription. If catalogDescription is empty, recall the plot of that exact author only. If the reader names a book and also says which part they want, return mode list and recommend only that part. If they name a book and nothing else, return mode similar: summary is the plot of this author only, and groups are the ingredients of that plot. Each label starts with "If you want". Four groups, four real books. If they do not name a book, return mode list with 12 books of any year. Return JSON {"mode":"similar","source":{"title":"","author":"","summary":""},"groups":[{"label":"If you want ...","books":[{"title":"","author":"","why":""}]}]} or {"mode":"list","note":"one sentence","books":[{"title":"","author":"","why":""}]}. Never invent a title.`

  const data = asRecord(
    await askModel(followUp, JSON.stringify({ ...input, matchedBook: matchedNote }), {
      timeoutMs: 10000,
      temperature: 0.2,
    }),
  )
  if (!data) return null
  const named = matched ? { title: matched.title, author: matched.authors[0] || '' } : undefined
  const similar = parseSimilar(data, named)
  if (similar) return similar
  if (data.mode === 'similar') {
    const source = asRecord(data.source)
    const title = (typeof source?.title === 'string' && source.title.trim()) || named?.title || ''
    const author = (typeof source?.author === 'string' && source.author.trim()) || named?.author || ''
    const retry = asRecord(
      await askModel(
        `The last answer described the wrong novel. ${title} by ${author} is not Marissa Meyer's Wonderland book, not Elsie Silver's book, and not Kat Martin's book. summary must be this author's plot only. If you are not sure, set summary to the catalogDescription and still build groups from that plot, not from a fantasy retelling. Return the same JSON shape.`,
        JSON.stringify({ ...input, matchedBook: matchedNote, rejected: source?.summary }),
        { timeoutMs: 8000, temperature: 0.1 },
      ),
    )
    const second = parseSimilar(retry, named)
    if (second) return second
    if (title && author) {
      return {
        mode: 'similar',
        source: {
          title,
          author,
          summary: matched?.description
            ? clip(matched.description, 320)
            : `This is ${title} by ${author}. A different novel shares the title, so name the part you want and Folio will search for that.`,
        },
        groups: [],
      }
    }
    return null
  }
  const picks = parsePicks(data.books, 12)
  if (picks.length === 0) return null
  const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : synthesizeNote(input)
  return { mode: 'list', note, picks }
}

function authorMatches(authors: string[], wantedAuthor: string): boolean {
  const wantedLast = normalize(lastName(wantedAuthor))
  if (wantedLast.length < 3) return false
  const wantedInitials = wantedAuthor
    .split(/\s+/)
    .slice(0, -1)
    .map((part) => normalize(part).replace(/[^a-z]/g, ''))
    .join('')
  return authors.some((name) => {
    const parts = name.split(/\s+/).filter(Boolean)
    const last = normalize(parts[parts.length - 1] ?? '')
    if (last !== wantedLast) return false
    if (wantedInitials.length < 2) return true
    const initials = parts
      .slice(0, -1)
      .map((part) => normalize(part).replace(/[^a-z]/g, ''))
      .join('')
    return initials === wantedInitials
  })
}

function pickMatch(found: Candidate[], title: string, author: string): Candidate | null {
  const titleHits = found.filter((book) => titlesMatch(title, book.title))
  const pool = author ? titleHits.filter((book) => authorMatches(book.authors, author)) : titleHits
  pool.sort((a, b) => {
    const described = Number(b.description.length > 80) - Number(a.description.length > 80)
    if (described) return described
    return (b.year ?? 0) - (a.year ?? 0)
  })
  return pool[0] ?? null
}

async function lookupTitle(title: string, author: string): Promise<Candidate | null> {
  const authorBit = lastName(author)
  const safeTitle = title.replace(/[&]/g, ' ')
  const googleQuery = authorBit ? `intitle:${safeTitle} inauthor:${authorBit}` : `intitle:${safeTitle}`
  const libraryQuery = author ? `${safeTitle} ${author}` : safeTitle
  const [google, library] = await Promise.all([
    searchGoogle(googleQuery, 8),
    searchOpenLibrary(libraryQuery, 8),
  ])
  return pickMatch([...google, ...library], title, author)
}

async function longerDescription(book: Candidate): Promise<string> {
  if (book.description.length >= 80 && book.id.startsWith('gb:')) return book.description
  if (book.id.startsWith('gb:')) {
    const params = new URLSearchParams()
    const key = readEnv('GOOGLE_BOOKS_API_KEY')
    if (key) params.set('key', key)
    const data = asRecord(await fetchJson(`https://www.googleapis.com/books/v1/volumes/${book.id.slice(3)}?${params}`))
    const info = asRecord(data?.volumeInfo)
    const text = typeof info?.description === 'string' ? plain(info.description) : ''
    if (text.length > book.description.length) return clip(text, 900)
  }
  if (book.id.startsWith('ol:') && book.description.length < 80) {
    const data = asRecord(await fetchJson(`https://openlibrary.org${book.id.slice(3)}.json`))
    const description = data?.description
    const text =
      typeof description === 'string'
        ? description
        : typeof asRecord(description)?.value === 'string'
          ? (asRecord(description)?.value as string)
          : ''
    if (text) return clip(plain(text), 900)
  }
  return book.description
}

async function describeSource(title: string, author: string): Promise<Candidate | null> {
  const match = await lookupTitle(title, author)
  if (!match) return null
  match.description = await longerDescription(match)
  return match
}

function extractNamedBook(query: string): { title: string; author: string } | null {
  const match = query.match(/\b(?:similar to|like)\s+["“']?(.+?)["”']?\s+by\s+(.+)$/i)
  if (!match) return null
  const title = match[1]?.trim() ?? ''
  const author = (match[2] ?? '')
    .split(/\b(?:i|and|because|with|where|who|that|about)\b/i)[0]
    ?.replace(/[.,!;:]+$/, '')
    .trim()
  if (title.length < 2 || !author || author.length < 2) return null
  return { title, author }
}

const OTHER_HEARTLESS = /\b(wonderland|queen of hearts|jester|jest|catherine|marissa meyer|chestnut springs|kingdom of hearts)\b/i

function describesAnotherBook(text: string, author: string): boolean {
  if (!OTHER_HEARTLESS.test(text)) return false
  return !OTHER_HEARTLESS.test(author)
}

async function recentFromCatalog(input: SearchInput): Promise<Candidate[]> {
  const queries = fallbackQueries(input)
  const batches = await Promise.all(
    queries.map(async (query) => {
      const [google, library] = await Promise.all([searchGoogle(query, 12), searchOpenLibrary(query, 12)])
      return [...google, ...library]
    }),
  )
  const ranked = newestFirst(dedupe(batches.flat()).filter(keep)).slice(0, 16)
  await attachDescriptions(ranked)
  return newestFirst(ranked.map((book) => ({ ...book, why: book.why || templateWhy(book, input) })))
}

async function verifyPicks(picks: TitlePick[], exclude: string[]): Promise<Candidate[]> {
  const fresh = picks.filter((pick) => !exclude.some((title) => titlesMatch(title, pick.title)))
  const lookups = await Promise.all(fresh.map((pick) => lookupTitle(pick.title, pick.author)))
  const books: Candidate[] = []
  lookups.forEach((book, index) => {
    const pick = fresh[index]
    if (!book || !pick) return
    books.push({ ...book, why: pick.why })
  })
  return newestFirst(dedupe(books))
}

async function findBooks(input: SearchInput): Promise<{
  books: BookMatch[]
  groups: BookGroup[]
  sourceBook?: SourceBook
  note: string
  usedAi: boolean
}> {
  const hinted = input.facet || input.exclude.length > 0 ? null : extractNamedBook(input.query)
  const hintedMatch = hinted ? await describeSource(hinted.title, hinted.author) : null
  const plan = await planRequest(input, hintedMatch)
  if (!plan) {
    const extras = (await recentFromCatalog(input)).filter(
      (book) => !input.exclude.some((title) => titlesMatch(title, book.title)),
    )
    return { books: extras.slice(0, 24).map(publish), groups: [], note: synthesizeNote(input), usedAi: false }
  }

  if (plan.mode === 'list') {
    let books = await verifyPicks(plan.picks, input.exclude)
    if (books.length < 8 && input.exclude.length === 0 && !input.facet) {
      const seen = new Set(books.map((book) => normalize(book.title)))
      for (const book of await recentFromCatalog(input)) {
        if (books.length >= 24) break
        if (seen.has(normalize(book.title))) continue
        books.push(book)
        seen.add(normalize(book.title))
      }
      books = newestFirst(books)
    }
    return {
      books: books.filter((book) => book.title && book.why).slice(0, 24).map(publish),
      groups: [],
      note: plan.note,
      usedAi: true,
    }
  }

  const sameHint =
    hintedMatch &&
    titlesMatch(plan.source.title, hintedMatch.title) &&
    authorMatches(hintedMatch.authors, plan.source.author)
  const [sourceMatch, verifiedGroups] = await Promise.all([
    sameHint ? Promise.resolve(hintedMatch) : lookupTitle(plan.source.title, plan.source.author),
    Promise.all(
      plan.groups.map(async (group, index) => ({
        id: `${normalize(group.label).slice(0, 60) || 'angle'}-${index}`,
        label: group.label,
        books: (await verifyPicks(group.picks, input.exclude)).map(publish),
      })),
    ),
  ])

  return {
    books: [],
    groups: verifiedGroups.filter((group) => group.books.length > 0),
    sourceBook: {
      title: sourceMatch?.title || plan.source.title,
      authors: sourceMatch?.authors.length ? sourceMatch.authors : [plan.source.author],
      year: sourceMatch?.year ?? null,
      coverUrl: sourceMatch?.coverUrl ?? null,
      infoUrl: sourceMatch?.infoUrl || `https://openlibrary.org/search?q=${encodeURIComponent(`${plan.source.title} ${plan.source.author}`)}`,
      summary: plan.source.summary,
    },
    note: plan.source.summary,
    usedAi: true,
  }
}

async function cacheResult(books: BookMatch[], input: SearchInput): Promise<void> {
  const url = readEnv('SUPABASE_URL').replace(/\/$/, '')
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key || books.length === 0) return
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  }
  try {
    await fetch(`${url}/rest/v1/books?on_conflict=id`, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        books.map((book) => ({
          id: book.id,
          title: book.title,
          authors: book.authors.join(', '),
          description: book.description,
          cover_url: book.coverUrl,
          published_year: book.year,
          info_url: book.infoUrl,
          why: book.why,
          updated_at: new Date().toISOString(),
        })),
      ),
    })
    await fetch(`${url}/rest/v1/searches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: input.query,
        genres: input.genres,
        tropes: input.tropes,
        movies: input.movies,
      }),
    })
  } catch {
    // Caching is optional. A missing table should not block a recommendation.
  }
}

export async function handleRecommend(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  if (limited(request)) return json({ error: 'Folio needs a short break. Try again in a few minutes.' }, 429)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'That request could not be read.' }, 400)
  }

  const record = asRecord(body) ?? {}
  const input: SearchInput = {
    query: typeof record.query === 'string' ? record.query.trim().slice(0, 500) : '',
    genres: cleanList(record.genres),
    tropes: cleanList(record.tropes),
    movies: cleanList(record.movies),
    exclude: cleanList(record.exclude, 60),
    facet: typeof record.facet === 'string' ? record.facet.trim().slice(0, 180) : '',
    sourceTitle: typeof record.sourceTitle === 'string' ? record.sourceTitle.trim().slice(0, 180) : '',
    sourceAuthor: typeof record.sourceAuthor === 'string' ? record.sourceAuthor.trim().slice(0, 120) : '',
    sourceSummary: typeof record.sourceSummary === 'string' ? record.sourceSummary.trim().slice(0, 400) : '',
  }

  if (!input.query && input.genres.length + input.tropes.length + input.movies.length === 0) {
    return json({ error: 'Tell Folio what you loved.' }, 400)
  }

  try {
    const result = await findBooks(input)
    const found = [...result.books, ...result.groups.flatMap((group) => group.books)]
    await cacheResult(found, input)
    return json(result)
  } catch {
    return json({ error: 'The shelf is busy. Try again in a moment.' }, 500)
  }
}

export const config = {
  runtime: 'edge',
}

export default function handler(request: Request): Promise<Response> {
  return handleRecommend(request)
}
