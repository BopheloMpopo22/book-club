import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import AccountChip from './community/AccountChip.tsx'
import Community from './community/Community.tsx'
import { genres, movies, searchHints, siteLine, siteName, tropes } from './data/discover.ts'
import { shelves, type CatalogBook } from './data/catalog.ts'
import { recoveryOpen, supabase } from './lib/supabase.ts'
import Pass from './search/Pass.tsx'
import { paypalOn } from './search/paypal.ts'
import type { BookGroup, BookMatch, RecommendResponse, ShelfBook, SourceBook } from './types.ts'

const PAGE = 12
const FREE_SEARCHES = 5

function guestSearches(): number {
  const count = Number(localStorage.getItem('booksrec-free-searches') || '0')
  return Number.isFinite(count) ? count : 0
}

async function accessToken(): Promise<string> {
  if (!supabase) return ''
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ''
}

function openCommunity(hash = window.location.hash, search = window.location.search) {
  return (
    hash.startsWith('#community') ||
    hash.startsWith('#profile') ||
    recoveryOpen(hash, search)
  )
}

function newest(list: BookMatch[]): BookMatch[] {
  return [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
}

function mergeBooks(current: BookMatch[], incoming: BookMatch[]): BookMatch[] {
  const seen = new Set(current.map((book) => book.id))
  return newest([...current, ...incoming.filter((book) => !seen.has(book.id))])
}

type Phase = 'idle' | 'loading' | 'ready'

function toggle(list: string[], value: string): string[] {
  if (list.includes(value)) return list.filter((item) => item !== value)
  return [...list, value].slice(-4)
}

function meta(authors: string[], year: number | null): string {
  return [authors.join(', '), year].filter(Boolean).join(' · ')
}

const PLAY_BOOK_MS = 5600
const PLAY_HEADLINE_MS = 2600

type Shown =
  | { kind: 'headline'; title: string }
  | {
      kind: 'work'
      kicker: string
      title: string
      authors: string[]
      year: number | null
      coverUrl: string | null
      coverKey: string
      text: string
      note: string
      infoUrl: string
    }

function bookCard(book: BookMatch): Shown {
  const why = book.why.trim()
  const description = book.description.trim()
  const same =
    description.length > 0 && why.length > 0 && description.includes(why.replace(/…$/, '').slice(0, 48))
  return {
    kind: 'work',
    kicker: '',
    title: book.title,
    authors: book.authors,
    year: book.year,
    coverUrl: book.coverUrl,
    coverKey: book.id,
    text: why || description,
    note: description && !same && description !== why ? description : '',
    infoUrl: book.infoUrl,
  }
}

function sourceCard(source: SourceBook): Shown {
  return {
    kind: 'work',
    kicker: 'This is the one you named',
    title: source.title,
    authors: source.authors,
    year: source.year,
    coverUrl: source.coverUrl,
    coverKey: source.title,
    text: source.summary,
    note: '',
    infoUrl: source.infoUrl,
  }
}

function buildSteps(source: SourceBook | null, groups: BookGroup[], books: BookMatch[]): Shown[] {
  const steps: Shown[] = []
  if (source) steps.push(sourceCard(source))
  for (const group of groups) {
    if (group.label) steps.push({ kind: 'headline', title: group.label })
  }
  const list = groups.length > 0 ? groups.flatMap((group) => group.books) : books
  for (const book of list) steps.push(bookCard(book))
  return steps
}

export default function App() {
  const [query, setQuery] = useState('')
  const [pickedGenres, setGenres] = useState<string[]>([])
  const [pickedTropes, setTropes] = useState<string[]>([])
  const [pickedMovies, setMovies] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [books, setBooks] = useState<BookMatch[]>([])
  const [groups, setGroups] = useState<BookGroup[]>([])
  const [sourceBook, setSourceBook] = useState<SourceBook | null>(null)
  const [visible, setVisible] = useState(PAGE)
  const [reading, setReading] = useState('')
  const [error, setError] = useState('')
  const [canLoadMore, setCanLoadMore] = useState(true)
  const [exhaustedGroups, setExhaustedGroups] = useState<Record<string, boolean>>({})
  const [loadingMore, setLoadingMore] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const [correction, setCorrection] = useState('')
  const [brokenCovers, setBrokenCovers] = useState<Record<string, boolean>>({})
  const [openMenu, setOpenMenu] = useState<'genre' | 'trope' | 'movie' | null>(null)
  const [passOpen, setPassOpen] = useState(false)
  const [hintIndex, setHintIndex] = useState(0)
  const [hintOn, setHintOn] = useState(true)
  const [area, setArea] = useState<'search' | 'community'>(() => (openCommunity() ? 'community' : 'search'))
  const [playbackOn, setPlaybackOn] = useState(() => localStorage.getItem('booksrec-playback') === '1')
  const [playIndex, setPlayIndex] = useState<number | null>(null)
  const [opened, setOpened] = useState<Shown | null>(null)
  const playbackRef = useRef(playbackOn)
  const busy = useRef(false)
  const bar = useRef<HTMLFormElement>(null)
  const searchRef = useRef<(text: string) => Promise<void>>(async () => {})

  useEffect(() => {
    const sync = () => {
      const next = openCommunity() ? 'community' : 'search'
      setArea(next)
      if (next !== 'search') {
        setPlayIndex(null)
        setOpened(null)
      }
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    function onOpen(event: Event) {
      const book = (event as CustomEvent<CatalogBook>).detail
      if (!book?.title) return
      if (window.location.hash) window.location.hash = ''
      const text = `Books like ${book.title}${book.authors[0] ? ` by ${book.authors[0]}` : ''}`
      void searchRef.current(text)
    }
    window.addEventListener('open-book', onOpen)
    return () => window.removeEventListener('open-book', onOpen)
  }, [])

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!bar.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [])

  useEffect(() => {
    if (query.trim()) return
    let fade = 0
    const id = window.setInterval(() => {
      setHintOn(false)
      fade = window.setTimeout(() => {
        setHintIndex((current) => (current + 1) % searchHints.length)
        setHintOn(true)
      }, 280)
    }, 3600)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(fade)
    }
  }, [query])

  const tags = [
    ...pickedGenres.map((label) => ({ label, group: 'genre' as const })),
    ...pickedTropes.map((label) => ({ label, group: 'trope' as const })),
    ...pickedMovies.map((label) => ({ label, group: 'movie' as const })),
  ]
  const canSearch = query.trim().length > 0 || tags.length > 0

  function removeTag(group: 'genre' | 'trope' | 'movie', label: string) {
    if (group === 'genre') setGenres((current) => current.filter((item) => item !== label))
    if (group === 'trope') setTropes((current) => current.filter((item) => item !== label))
    if (group === 'movie') setMovies((current) => current.filter((item) => item !== label))
  }

  async function ask(body: Record<string, unknown>): Promise<RecommendResponse | null> {
    const token = await accessToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = (await response.json()) as RecommendResponse
    if (!response.ok) {
      if (data.code === 'pass') {
        if (paypalOn) {
          setPassOpen(true)
          setError('')
        } else setError(data.error || 'Five free searches are included. Booksrec is $2 a month after that.')
        return null
      }
      setError(data.error || 'Search failed.')
      return null
    }
    return data
  }

  function requestBody(text: string, extra: Record<string, unknown> = {}) {
    return {
      query: text,
      genres: pickedGenres,
      tropes: pickedTropes,
      movies: pickedMovies,
      ...extra,
    }
  }

  async function search(nextQuery = query) {
    const text = nextQuery.trim()
    if (busy.current) return
    if (!text && pickedGenres.length + pickedTropes.length + pickedMovies.length === 0) return
    const token = paypalOn ? await accessToken() : ''
    if (paypalOn && !token && guestSearches() >= FREE_SEARCHES) {
      setPassOpen(true)
      return
    }
    busy.current = true
    setQuery(nextQuery)
    setPhase('loading')
    setError('')
    setBooks([])
    setGroups([])
    setSourceBook(null)
    setReading('')
    setVisible(PAGE)
    setCanLoadMore(true)
    setExhaustedGroups({})
    setCorrecting(false)
    setCorrection('')
    setPlayIndex(null)
    setOpened(null)
    try {
      const data = await ask(requestBody(text))
      if (!data) {
        setPhase('ready')
        return
      }
      const nextBooks = newest(data.books ?? [])
      const nextGroups = (data.groups ?? []).map((group) => ({ ...group, books: newest(group.books) }))
      setBooks(nextBooks)
      setGroups(nextGroups)
      setSourceBook(data.sourceBook ?? null)
      setReading(data.reading || data.note || '')
      setVisible(PAGE)
      setCanLoadMore(true)
      setPhase('ready')
      if (
        playbackRef.current &&
        (nextBooks.length > 0 || nextGroups.length > 0 || data.sourceBook)
      ) {
        setPlayIndex(0)
      }
      if (paypalOn && !token) localStorage.setItem('booksrec-free-searches', String(guestSearches() + 1))
      if (!nextBooks.length && !nextGroups.length && !data.sourceBook) {
        setError('Nothing close enough turned up. Name the hero, the job, or a book it felt like.')
      }
      requestAnimationFrame(() => {
        document.getElementById('matches')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch {
      setPhase('ready')
      setError('Booksrec could not reach the catalogs. Try again in a moment.')
    } finally {
      busy.current = false
    }
  }

  async function loadMore(group?: BookGroup) {
    const text = query.trim()
    if (busy.current || !text) return
    if (!group && visible < books.length) {
      setVisible((count) => Math.min(books.length, count + PAGE))
      return
    }
    busy.current = true
    setLoadingMore(group?.id ?? 'list')
    setError('')
    try {
      const data = await ask(
        requestBody(text, {
          exclude: (group ? group.books : books).map((book) => book.title),
          facet: group?.label ?? '',
          sourceTitle: sourceBook?.title ?? '',
          sourceAuthor: sourceBook?.authors[0] ?? '',
          sourceSummary: sourceBook?.summary || reading,
        }),
      )
      if (!data) return
      const incoming = newest(data.books ?? [])
      if (!group) {
        const next = mergeBooks(books, incoming)
        if (next.length === books.length) setCanLoadMore(false)
        else {
          setBooks(next)
          setVisible((count) => count + PAGE)
        }
      } else if (incoming.length === 0) {
        setExhaustedGroups((current) => ({ ...current, [group.id]: true }))
      } else {
        setGroups((current) =>
          current.map((item) => (item.id === group.id ? { ...item, books: mergeBooks(item.books, incoming) } : item)),
        )
      }
    } catch {
      setError('Booksrec could not reach the catalogs. Try again in a moment.')
    } finally {
      setLoadingMore('')
      busy.current = false
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void search()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void search()
    }
  }

  function reset() {
    setQuery('')
    setGenres([])
    setTropes([])
    setMovies([])
    setBooks([])
    setGroups([])
    setSourceBook(null)
    setVisible(PAGE)
    setReading('')
    setError('')
    setCanLoadMore(true)
    setExhaustedGroups({})
    setCorrecting(false)
    setCorrection('')
    setPhase('idle')
    setPlayIndex(null)
    setOpened(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const steps = useMemo(
    () => buildSteps(sourceBook, groups, books.slice(0, visible)),
    [sourceBook, groups, books, visible],
  )
  const activeIndex = playIndex !== null && playIndex < steps.length ? playIndex : null
  const shown = activeIndex !== null ? steps[activeIndex] : opened

  useEffect(() => {
    if (area !== 'search' || activeIndex === null) return
    const delay = steps[activeIndex]?.kind === 'headline' ? PLAY_HEADLINE_MS : PLAY_BOOK_MS
    const id = window.setTimeout(() => setPlayIndex(activeIndex + 1), delay)
    return () => window.clearTimeout(id)
  }, [area, activeIndex, steps])

  function showCard(card: Shown) {
    setPlayIndex(null)
    setOpened(card)
  }

  function closeShown() {
    setPlayIndex(null)
    setOpened(null)
  }

  function togglePlayback() {
    const next = !playbackOn
    setPlaybackOn(next)
    localStorage.setItem('booksrec-playback', next ? '1' : '0')
    setOpened(null)
    if (!next) {
      setPlayIndex(null)
      return
    }
    if (phase === 'ready' && steps.length > 0) setPlayIndex(0)
  }

  useEffect(() => {
    playbackRef.current = playbackOn
    searchRef.current = search
  })

  return (
    <div className="page">
      <header className="top">
        <button
          type="button"
          className="mark"
          onClick={() => {
            if (window.location.hash) window.location.hash = ''
            reset()
          }}
        >
          {siteName}
        </button>
        <p className="line">{area === 'community' ? 'One conversation for book lovers.' : siteLine}</p>
        <nav className="nav" aria-label="Site">
          <button type="button" className="nav-link" aria-current={area === 'search' ? 'page' : undefined} onClick={() => {
            if (window.location.hash) window.location.hash = ''
          }}>
            Search
          </button>
          <button type="button" className="nav-link" aria-current={area === 'community' ? 'page' : undefined} onClick={() => {
            window.location.hash = 'community'
          }}>
            Community
          </button>
          <AccountChip />
        </nav>
      </header>

      {area === 'community' ? (
        <Community />
      ) : (
      <>
      <main className="stage">
        <form className="search" onSubmit={onSubmit} ref={bar}>
          <div className="search-row">
            <div className="search-main">
              {tags.length > 0 && (
                <div className="tags">
                  {tags.map((tag) => (
                    <button
                      key={`${tag.group}-${tag.label}`}
                      type="button"
                      className="tag"
                      onClick={() => removeTag(tag.group, tag.label)}
                    >
                      {tag.label} <span aria-hidden="true">×</span>
                      <span className="sr-only">Remove {tag.label}</span>
                    </button>
                  ))}
                </div>
              )}
              <label className="sr-only" htmlFor="ask">
                Describe the book you want
              </label>
              <textarea
                id="ask"
                rows={2}
                value={query}
                placeholder="Tell it anything. A feeling, a job, a person, a book it felt like…"
                onChange={(event) => {
                  const el = event.currentTarget
                  el.style.height = 'auto'
                  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
                  setQuery(el.value)
                }}
                onKeyDown={onKeyDown}
              />
            </div>
            <button className="send" type="submit" disabled={!canSearch || phase === 'loading' || Boolean(loadingMore)} aria-label="Find books">
              {phase === 'loading' ? <span className="spinner" /> : <ArrowIcon />}
            </button>
          </div>
          <div className="search-foot">
            <div className="menus">
              <MenuWord
                label="Genre"
                open={openMenu === 'genre'}
                picked={pickedGenres.length}
                onClick={() => setOpenMenu((current) => (current === 'genre' ? null : 'genre'))}
              />
              <MenuWord
                label="Trope"
                open={openMenu === 'trope'}
                picked={pickedTropes.length}
                onClick={() => setOpenMenu((current) => (current === 'trope' ? null : 'trope'))}
              />
              <MenuWord
                label="Movie"
                open={openMenu === 'movie'}
                picked={pickedMovies.length}
                onClick={() => setOpenMenu((current) => (current === 'movie' ? null : 'movie'))}
              />
            </div>
            {!query.trim() && (
              <p className="hint" aria-hidden="true">
                <span className={hintOn ? 'hint-line' : 'hint-line off'}>{searchHints[hintIndex]}</span>
              </p>
            )}
        </div>
          {openMenu && (
            <div className="menu-panel" role="group" aria-label={openMenu}>
              {(openMenu === 'genre' ? genres : openMenu === 'trope' ? tropes : movies).map((option) => {
                const selected =
                  openMenu === 'genre'
                    ? pickedGenres.includes(option)
                    : openMenu === 'trope'
                      ? pickedTropes.includes(option)
                      : pickedMovies.includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    className="choice"
                    aria-pressed={selected}
                    onClick={() => {
                      if (openMenu === 'genre') setGenres((current) => toggle(current, option))
                      if (openMenu === 'trope') setTropes((current) => toggle(current, option))
                      if (openMenu === 'movie') setMovies((current) => toggle(current, option))
                    }}
                  >
                    {option}
                  </button>
                )
              })}
            </div>
          )}
        </form>
        {passOpen && paypalOn && <Pass onClose={() => setPassOpen(false)} onReady={() => setPassOpen(false)} />}

        <div className="status-row">
          <p className="status" role="status">
            {phase === 'loading' ? 'Finding the closest books…' : error}
          </p>
          <button type="button" className={playbackOn ? 'play-switch on' : 'play-switch'} aria-pressed={playbackOn} onClick={togglePlayback}>
            {playbackOn ? 'Playback on' : 'Playback off'}
          </button>
        </div>

        {phase !== 'idle' && (
          <section className="matches" id="matches" aria-live="polite">
            {phase === 'loading' && books.length === 0 && groups.length === 0 ? (
              <div className="skeletons" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ) : (
              <>
                {reading && <p className="reading">{reading}</p>}
                {sourceBook && (
                  <article className="source">
                    <button type="button" className="cover-hit" onClick={() => showCard(sourceCard(sourceBook))}>
                      <Cover
                        title={sourceBook.title}
                        src={sourceBook.coverUrl}
                        broken={Boolean(brokenCovers[sourceBook.title])}
                        onBroken={() => setBrokenCovers((current) => ({ ...current, [sourceBook.title]: true }))}
                      />
                    </button>
                    <div>
                      <p className="eyebrow">This is the one you named</p>
                      <h2>
                        <button type="button" className="source-open" onClick={() => showCard(sourceCard(sourceBook))}>
                          {sourceBook.title}
                        </button>
                      </h2>
                      <p className="meta">{meta(sourceBook.authors, sourceBook.year)}</p>
                      <p className="why">{sourceBook.summary}</p>
                      {correcting ? (
                        <form
                          className="correct"
                          onSubmit={(event) => {
                            event.preventDefault()
                            const text = correction.trim()
                            if (text) void search(`Books similar to ${text}`)
                          }}
                        >
                          <label className="sr-only" htmlFor="correction">
                            The book you meant
                          </label>
                          <input
                            id="correction"
                            value={correction}
                            placeholder="Title and author"
                            onChange={(event) => setCorrection(event.target.value)}
                          />
                          <button type="submit" className="more" disabled={!correction.trim()}>
                            Use this book
                          </button>
                        </form>
                      ) : (
                        <button type="button" className="quiet" onClick={() => setCorrecting(true)}>
                          Not this book
                        </button>
                      )}
                    </div>
                  </article>
                )}
                {groups.map((group) => (
                  <div className="group" key={group.id}>
                    <h2>{group.label}</h2>
                    <BookList
                      books={group.books}
                      brokenCovers={brokenCovers}
                      onBroken={(id) => setBrokenCovers((current) => ({ ...current, [id]: true }))}
                      onOpen={(book) => showCard(bookCard(book))}
                    />
                    {!exhaustedGroups[group.id] && (
                      <button
                        type="button"
                        className="more"
                        disabled={loadingMore === group.id}
                        onClick={() => void loadMore(group)}
                      >
                        {loadingMore === group.id ? 'Looking…' : 'More'}
                      </button>
                    )}
                  </div>
                ))}
                {books.length > 0 && (
                  <>
                    <BookList
                      books={books.slice(0, visible)}
                      brokenCovers={brokenCovers}
                      onBroken={(id) => setBrokenCovers((current) => ({ ...current, [id]: true }))}
                      onOpen={(book) => showCard(bookCard(book))}
                    />
                    {(visible < books.length || canLoadMore) && (
                      <button
                        type="button"
                        className="more"
                        disabled={loadingMore === 'list'}
                        onClick={() => void loadMore()}
                      >
                        {loadingMore === 'list' ? 'Looking…' : 'More'}
                      </button>
                    )}
                  </>
                )}
                {sourceBook && groups.length === 0 && books.length === 0 && (
                  <p className="meta">Name the part you want, like the affair or the age gap, and Booksrec will look for that.</p>
                )}
              </>
            )}
          </section>
        )}
      </main>

      {shelves.map((row, index) => (
        <section className="shelf" aria-label={row.title} key={row.id}>
          <div className="shelf-head">
            <h2>{row.title}</h2>
            <p>{row.line}</p>
          </div>
          <div className="marquee">
            <div className={index % 2 ? 'track reverse' : 'track'} style={{ animationDuration: `${92 + index * 14}s` }}>
              {[0, 1].map((copy) =>
                row.books.map((book) => (
                  <ShelfCard
                    key={`${book.id}-${copy}`}
                    book={book}
                    hiddenCopy={copy === 1}
                    broken={Boolean(brokenCovers[book.id])}
                    onBroken={() => setBrokenCovers((current) => ({ ...current, [book.id]: true }))}
                    onPick={() => {
                      const text = `Books like ${book.title}${book.authors[0] ? ` by ${book.authors[0]}` : ''}`
                      void search(text)
                    }}
                  />
                )),
              )}
            </div>
        </div>
      </section>
      ))}

      <p className="fine">
        Covers come from Open Library, Google Books, and Wikipedia. Booksrec recommends the book. It does not host the file.
      </p>
      </>
      )}
      {area === 'search' && shown && (
        <Spotlight
          item={shown}
          stepKey={activeIndex !== null ? `play-${activeIndex}` : `open-${shown.kind}-${shown.title}`}
          broken={shown.kind === 'work' && Boolean(brokenCovers[shown.coverKey])}
          onBroken={() => {
            if (shown.kind === 'work') setBrokenCovers((current) => ({ ...current, [shown.coverKey]: true }))
          }}
          onClose={closeShown}
        />
      )}
    </div>
  )
}

function MenuWord({
  label,
  open,
  picked,
  onClick,
}: {
  label: string
  open: boolean
  picked: number
  onClick: () => void
}) {
  return (
    <button type="button" className={picked ? 'menu-word picked' : 'menu-word'} aria-expanded={open} onClick={onClick}>
      {label}
      {picked > 0 ? ` ${picked}` : ''}
    </button>
  )
}

function ShelfCard({
  book,
  broken,
  hiddenCopy,
  onBroken,
  onPick,
}: {
  book: ShelfBook
  broken: boolean
  hiddenCopy: boolean
  onBroken: () => void
  onPick: () => void
}) {
  return (
    <button type="button" className="shelf-card" aria-hidden={hiddenCopy} tabIndex={hiddenCopy ? -1 : 0} onClick={onPick}>
      <Cover title={book.title} src={book.coverUrl} broken={broken} onBroken={onBroken} />
      <span className="shelf-title">{book.title}</span>
      <span className="shelf-author">{book.authors[0]}</span>
    </button>
  )
}

function BookList({
  books,
  brokenCovers,
  onBroken,
  onOpen,
}: {
  books: BookMatch[]
  brokenCovers: Record<string, boolean>
  onBroken: (id: string) => void
  onOpen: (book: BookMatch) => void
}) {
  return (
    <ul>
      {books.map((book) => (
        <li key={book.id}>
          <ResultBook
            book={book}
            broken={Boolean(brokenCovers[book.id])}
            onBroken={() => onBroken(book.id)}
            onOpen={() => onOpen(book)}
          />
        </li>
      ))}
    </ul>
  )
}

function ResultBook({
  book,
  broken,
  onBroken,
  onOpen,
}: {
  book: BookMatch
  broken: boolean
  onBroken: () => void
  onOpen: () => void
}) {
  const showBlurb =
    book.description.length > 0 && !book.description.includes(book.why.replace(/…$/, '').slice(0, 48))
  return (
    <button type="button" className="result" onClick={onOpen}>
      <Cover title={book.title} src={book.coverUrl} broken={broken} onBroken={onBroken} />
      <div>
        <h3>{book.title}</h3>
        <p className="meta">{meta(book.authors, book.year)}</p>
        <p className="why">{book.why}</p>
        {showBlurb && <p className="blurb">{book.description}</p>}
      </div>
    </button>
  )
}

function Spotlight({
  item,
  stepKey,
  broken,
  onBroken,
  onClose,
}: {
  item: Shown
  stepKey: string
  broken: boolean
  onBroken: () => void
  onClose: () => void
}) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [])
  const label = item.title
  return (
    <div className="spotlight" onClick={onClose}>
      <div
        key={stepKey}
        className={item.kind === 'headline' ? 'spotlight-card headline' : 'spotlight-card'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="spotlight-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {item.kind === 'headline' ? (
          <h2>{item.title}</h2>
        ) : (
          <>
            {item.kicker && <p className="eyebrow">{item.kicker}</p>}
            <Cover title={item.title} src={item.coverUrl} broken={broken} onBroken={onBroken} />
            <h2>{item.title}</h2>
            <p className="meta">{meta(item.authors, item.year)}</p>
            {item.text && <p className="spotlight-copy">{item.text}</p>}
            {item.note && <p className="spotlight-note">{item.note}</p>}
            {item.infoUrl && (
              <a className="quiet" href={item.infoUrl} target="_blank" rel="noreferrer">
                More about this
              </a>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Cover({
  title,
  src,
  broken,
  onBroken,
}: {
  title: string
  src: string | null
  broken: boolean
  onBroken: () => void
}) {
  if (!src || broken) {
    return (
      <span className="spine" aria-hidden="true">
        {title}
      </span>
    )
  }
  return <img src={src} alt="" onError={onBroken} />
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M12 19V5M12 5l-6 6M12 5l6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
