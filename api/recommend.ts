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

type SearchInput = {
  query: string
  genres: string[]
  tropes: string[]
  movies: string[]
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
    fields: 'key,title,author_name,first_publish_year,cover_i,isbn,edition_count',
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
    books.push({
      id: `ol:${key}`,
      title: clip(title, 180),
      authors,
      year: yearFrom(record?.first_publish_year),
      description: '',
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

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word))
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'book',
  'books',
  'like',
  'novel',
  'story',
  'about',
  'into',
  'your',
  'you',
  'was',
  'were',
  'have',
  'has',
])

function rank(books: Candidate[], input: SearchInput): Candidate[] {
  const words = tokens(
    [input.query, ...input.genres, ...input.tropes, ...input.movies].join(' '),
  )
  return books
    .map((book) => {
      const hay = `${book.title} ${book.authors.join(' ')} ${book.description}`.toLowerCase()
      let score = 0
      for (const word of words) {
        if (hay.includes(word)) score += 2
      }
      if (book.coverUrl) score += 4
      if (!book.coverUrl) score -= 8
      if (book.description.length > 80) score += 3
      if (book.year && book.year >= THIS_YEAR - 10 && book.year <= THIS_YEAR) score += 8
      if (book.year && book.year >= THIS_YEAR - 4) score += 4
      if (book.year != null && book.year < THIS_YEAR - 10) score -= 30
      if (book.year && book.year > THIS_YEAR + 1) score -= 2
      if (/[_]|novels\b|box ?set|omnibus|collection|complete series|books \d/i.test(book.title)) score -= 10
      if (book.title.length > 90) score -= 2
      return { book, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.book)
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
  if (input.query) queries.push(`${input.query} novel`)
  for (const trope of input.tropes) queries.push(TROPE_QUERIES[trope] ?? `${trope} novel`)
  if (input.genres[0] && !input.tropes.length && !input.query) queries.push(`${input.genres[0]} novel`)
  for (const movie of input.movies) queries.push(`novels like the movie ${movie}`)
  if (queries.length === 0) queries.push('popular recent romance fantasy novel')
  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()))].slice(0, 3)
}

function synthesizeNote(input: SearchInput): string {
  if (input.query) return `For “${clip(input.query, 110)}”`
  const parts = [...input.tropes, ...input.genres, ...input.movies]
  if (parts.length) return `For ${parts.join(', ')}`
  return 'Closest recent matches'
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

async function askModel(system: string, user: string): Promise<unknown> {
  const key = readEnv('OPENAI_API_KEY')
  if (!key) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
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
        temperature: 0.4,
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

function wantsOlderBooks(input: SearchInput): boolean {
  const text = [input.query, ...input.genres, ...input.tropes, ...input.movies].join(' ').toLowerCase()
  return /\b(classic|classics|victorian|shakespeare|public domain|19th|18th|historical fiction)\b/.test(text)
}

function minimumYear(input: SearchInput): number {
  return wantsOlderBooks(input) ? 0 : THIS_YEAR - 10
}

function lastName(author: string): string {
  const parts = author.split(' ').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function titlesMatch(wanted: string, found: string): boolean {
  const clean = (value: string) => normalize(value.replace(/\b(a novel|novel)\b/gi, ''))
  const left = clean(wanted)
  const right = clean(found)
  if (left.length < 4 || right.length < 4) return false
  return left === right || left.startsWith(right) || right.startsWith(left)
}

function isRecentEnough(book: Candidate, minYear: number, allowUnknown = false): boolean {
  if (!minYear) return true
  if (book.year == null) return allowUnknown
  return book.year >= minYear
}

type TitlePick = { title: string; author: string; why: string }

async function suggestTitles(input: SearchInput): Promise<{ note: string; picks: TitlePick[] } | null> {
  const data = asRecord(
    await askModel(
      `You recommend real published novels for a specific feeling, job, setting, or situation. Prefer books published from ${THIS_YEAR - 10} to ${THIS_YEAR}, including recent romance and books readers talk about now, unless the reader explicitly asked for a classic or historical fiction. Return JSON {"note":"one sentence","books":[{"title":"exact title","author":"full author name","why":"one concrete sentence"}]} with 8 to 12 books. Only include books you are confident exist. Never invent a title or author.`,
      JSON.stringify(input),
    ),
  )
  if (!data) return null
  const picks = Array.isArray(data.books)
    ? data.books.flatMap((item) => {
        const record = asRecord(item)
        const title = typeof record?.title === 'string' ? record.title.trim() : ''
        const author = typeof record?.author === 'string' ? record.author.trim() : ''
        const why = typeof record?.why === 'string' ? clip(record.why, 240) : ''
        return title && author && why ? [{ title, author, why }] : []
      })
    : []
  if (picks.length === 0) return null
  const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : synthesizeNote(input)
  return { note, picks: picks.slice(0, 12) }
}

async function lookupTitle(title: string, author: string): Promise<Candidate | null> {
  const authorBit = lastName(author)
  const googleQuery = authorBit ? `intitle:${title} inauthor:${authorBit}` : `intitle:${title}`
  const libraryQuery = authorBit ? `${title} ${authorBit}` : title
  const [google, library] = await Promise.all([
    searchGoogle(googleQuery, 5),
    searchOpenLibrary(libraryQuery, 5),
  ])
  const found = [...google, ...library]
  const named = authorBit
    ? found.find(
        (book) =>
          titlesMatch(title, book.title) &&
          book.authors.some((name) => normalize(name).includes(normalize(authorBit))),
      )
    : undefined
  return named ?? found.find((book) => titlesMatch(title, book.title)) ?? null
}

async function recentFromCatalog(input: SearchInput, minYear: number): Promise<Candidate[]> {
  const queries = fallbackQueries(input)
  const batches = await Promise.all(
    queries.map(async (query) => {
      const [google, library] = await Promise.all([searchGoogle(query, 12), searchOpenLibrary(query, 12)])
      return [...google, ...library]
    }),
  )
  const ranked = rank(dedupe(batches.flat()), input)
    .filter((book) => isRecentEnough(book, minYear))
    .filter(keep)
    .slice(0, 12)
  await attachDescriptions(ranked)
  return ranked.map((book) => ({ ...book, why: book.why || templateWhy(book, input) }))
}

async function findBooks(input: SearchInput): Promise<{ books: BookMatch[]; note: string; usedAi: boolean }> {
  const minYear = minimumYear(input)
  const suggested = await suggestTitles(input)
  const verified: Candidate[] = []

  if (suggested) {
    const lookups = await Promise.all(suggested.picks.map((pick) => lookupTitle(pick.title, pick.author)))
    lookups.forEach((book, index) => {
      const pick = suggested.picks[index]
      if (!book || !pick || !isRecentEnough(book, minYear, true)) return
      verified.push({ ...book, why: pick.why })
    })
  }

  const namedBooks = dedupe(verified)
  const seen = new Set(namedBooks.map((book) => normalize(book.title)))
  const extras = verified.length >= 8 ? [] : await recentFromCatalog(input, minYear)
  for (const book of extras) {
    if (namedBooks.length >= 12) break
    if (seen.has(normalize(book.title))) continue
    namedBooks.push(book)
    seen.add(normalize(book.title))
  }

  const byYear = (book: Candidate) => book.year ?? 0
  const named = namedBooks.filter((book) => suggested?.picks.some((pick) => titlesMatch(pick.title, book.title)))
  const rest = namedBooks.filter((book) => !named.includes(book))
  named.sort((a, b) => byYear(b) - byYear(a))
  rest.sort((a, b) => byYear(b) - byYear(a))

  return {
    books: [...named, ...rest]
      .filter((book) => book.title && book.why && isRecentEnough(book, minYear))
      .slice(0, 12)
      .map(publish),
    note: suggested?.note ?? synthesizeNote(input),
    usedAi: Boolean(suggested),
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
  }

  if (!input.query && input.genres.length + input.tropes.length + input.movies.length === 0) {
    return json({ error: 'Tell Folio what you loved.' }, 400)
  }

  try {
    const result = await findBooks(input)
    await cacheResult(result.books, input)
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
