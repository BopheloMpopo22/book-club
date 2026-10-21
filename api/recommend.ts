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

async function askModel(system: string, user: string): Promise<unknown> {
  const key = readEnv('OPENAI_API_KEY')
  if (!key) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 18000)
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: readEnv('OPENAI_MODEL') || 'gpt-4o',
        temperature: 0.3,
        max_tokens: 1800,
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

type NamedWork = { title: string; author: string; summary: string }

type Plan =
  | { mode: 'list'; reading: string; picks: TitlePick[]; source?: NamedWork }
  | {
      mode: 'similar'
      reading: string
      source: NamedWork
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

function parseNamed(value: unknown): NamedWork | null {
  const source = asRecord(value)
  const title = typeof source?.title === 'string' ? source.title.trim() : ''
  const author = typeof source?.author === 'string' ? source.author.trim() : ''
  const summary = typeof source?.summary === 'string' ? clip(source.summary, 560) : ''
  if (!title || !author || !summary) return null
  return { title, author, summary }
}

function parseReading(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? clip(value.trim(), 700) : fallback
}

async function planRequest(input: SearchInput): Promise<Plan | null> {
  const followUp = input.facet
    ? `The reader already named ${input.sourceTitle} by ${input.sourceAuthor}. What that work is: ${input.sourceSummary || 'use only this work'}. They want more books only for this ingredient: ${input.facet}. Stay on that ingredient. Include a newer book when it truly fits, and keep older true matches too. Do not repeat: ${input.exclude.join('; ') || 'none'}. Return JSON {"reading":"one sentence","mode":"list","books":[{"title":"","author":"","why":""}]} with 8 real books.`
    : input.exclude.length > 0
      ? `Give 8 more real novels for the same request. Include a newer book when it truly fits, and keep older true matches too. Do not repeat: ${input.exclude.join('; ')}. Return JSON {"reading":"one sentence","mode":"list","books":[{"title":"","author":"","why":""}]}.`
      : `You recommend books the way a careful conversation would. Understand the request before you name anything. Return JSON only.

reading: 2 to 4 sentences spoken to the reader. Restate what they asked and what it implies. If they named a book and a reason, say how that reason shows up in the book, then what kind of book that means they want.

Use mode "similar" when they name a book or a movie and do not say which part they want. source must be the work they named. Do not swap it for a more famous work with the same title. summary says what actually happens: the people, the situation, and the real ingredients. groups are those ingredients, four of them. Each label starts with "If you want" and states one ingredient. Three real books in each group. why names that shared ingredient.

Use mode "focused" when they name a book or a movie and also say what they like about it. source is that work. summary explains that exact trait in the work. books are eight novels that share the trait. why ties each book to the trait they named.

Use mode "list" when they do not name a specific work. books are eight novels. why ties each one to the reading.

For a movie, author is the director. Never invent a title or author. Do not stay in the decade of the book or movie they named. When a newer novel is a real match, include it. An older novel that is a true match stays too. If every true match is old, name those.

{"reading":"","mode":"similar","source":{"title":"","author":"","summary":""},"groups":[{"label":"If you want ...","books":[{"title":"","author":"","why":""}]}]}
{"reading":"","mode":"focused","source":{"title":"","author":"","summary":""},"books":[{"title":"","author":"","why":""}]}
{"reading":"","mode":"list","books":[{"title":"","author":"","why":""}]}`

  const data = asRecord(await askModel(followUp, JSON.stringify(input)))
  if (!data) return null
  const named = parseNamed(data.source)
  if (data.mode === 'similar' && named) {
    const groups = Array.isArray(data.groups)
      ? data.groups.flatMap((item) => {
          const record = asRecord(item)
          const label = typeof record?.label === 'string' ? record.label.trim() : ''
          const picks = parsePicks(record?.books, 3)
          return label && picks.length ? [{ label, picks }] : []
        })
      : []
    if (groups.length > 0) {
      return { mode: 'similar', reading: parseReading(data.reading, named.summary), source: named, groups: groups.slice(0, 4) }
    }
  }
  if ((data.mode === 'focused' || data.mode === 'similar') && named) {
    const picks = parsePicks(data.books, 8)
    if (picks.length > 0) return { mode: 'list', reading: parseReading(data.reading, named.summary), picks, source: named }
  }
  const picks = parsePicks(data.books, 8)
  if (picks.length === 0) return null
  const reading = parseReading(data.reading, synthesizeNote(input))
  return { mode: 'list', reading, picks }
}

function pickMatch(found: Candidate[], title: string, authorBit: string): Candidate | null {
  const titleHits = found.filter((book) => titlesMatch(title, book.title))
  const authorHits = authorBit
    ? titleHits.filter((book) => book.authors.some((name) => normalize(name).includes(normalize(authorBit))))
    : []
  const pool = authorBit ? authorHits : titleHits
  pool.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  return pool[0] ?? null
}

async function lookupTitle(title: string, author: string): Promise<Candidate | null> {
  const authorBit = lastName(author)
  const safeTitle = title.replace(/[&]/g, ' ')
  const googleQuery = authorBit ? `intitle:${safeTitle} inauthor:${authorBit}` : `intitle:${safeTitle}`
  const libraryQuery = authorBit ? `${safeTitle} ${authorBit}` : safeTitle
  const [google, library] = await Promise.all([
    searchGoogle(googleQuery, 5),
    searchOpenLibrary(libraryQuery, 5),
  ])
  return pickMatch([...google, ...library], title, authorBit)
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

async function sourceCard(source: NamedWork): Promise<SourceBook> {
  const match = await lookupTitle(source.title, source.author)
  return {
    title: match?.title || source.title,
    authors: match?.authors.length ? match.authors : [source.author],
    year: match?.year ?? null,
    coverUrl: match?.coverUrl ?? null,
    infoUrl:
      match?.infoUrl ||
      `https://openlibrary.org/search?q=${encodeURIComponent(`${source.title} ${source.author}`)}`,
    summary: source.summary,
  }
}

async function findBooks(input: SearchInput): Promise<{
  books: BookMatch[]
  groups: BookGroup[]
  sourceBook?: SourceBook
  note: string
  reading: string
  usedAi: boolean
}> {
  const plan = await planRequest(input)
  if (!plan) {
    const extras = (await recentFromCatalog(input)).filter(
      (book) => !input.exclude.some((title) => titlesMatch(title, book.title)),
    )
    const note = synthesizeNote(input)
    return { books: extras.slice(0, 24).map(publish), groups: [], note, reading: note, usedAi: false }
  }

  if (plan.mode === 'list') {
    const [books, sourceBook] = await Promise.all([
      verifyPicks(plan.picks, input.exclude),
      plan.source ? sourceCard(plan.source) : Promise.resolve(undefined),
    ])
    return {
      books: books.filter((book) => book.title && book.why).slice(0, 24).map(publish),
      groups: [],
      sourceBook,
      note: plan.reading,
      reading: plan.reading,
      usedAi: true,
    }
  }

  const [sourceBook, verifiedGroups] = await Promise.all([
    sourceCard(plan.source),
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
    sourceBook,
    note: plan.reading,
    reading: plan.reading,
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
    sourceSummary: typeof record.sourceSummary === 'string' ? record.sourceSummary.trim().slice(0, 700) : '',
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
