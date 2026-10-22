import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import AccountChip from './community/AccountChip.tsx'
import Community from './community/Community.tsx'
import { genres, movies, searchHints, siteLine, siteName, tropes } from './data/discover.ts'
import { shelf } from './data/shelf.ts'
import type { BookGroup, BookMatch, RecommendResponse, ShelfBook, SourceBook } from './types.ts'

const PAGE = 12

function openCommunity(hash = window.location.hash, search = window.location.search) {
  return (
    hash.startsWith('#community') ||
    hash.startsWith('#profile') ||
    hash.includes('type=recovery') ||
    search.includes('type=recovery')
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
  const [hintIndex, setHintIndex] = useState(0)
  const [hintOn, setHintOn] = useState(true)
  const [area, setArea] = useState<'search' | 'community'>(() => (openCommunity() ? 'community' : 'search'))
  const busy = useRef(false)
  const bar = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const sync = () => setArea(openCommunity() ? 'community' : 'search')
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
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
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await response.json()) as RecommendResponse
    if (!response.ok) {
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
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

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

        <p className="status" role="status">
          {phase === 'loading' ? 'Finding the closest books…' : error}
        </p>

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
                    <Cover
                      title={sourceBook.title}
                      src={sourceBook.coverUrl}
                      broken={Boolean(brokenCovers[sourceBook.title])}
                      onBroken={() => setBrokenCovers((current) => ({ ...current, [sourceBook.title]: true }))}
                    />
                    <div>
                      <p className="eyebrow">This is the one you named</p>
                      <h2>
                        <a href={sourceBook.infoUrl} target="_blank" rel="noreferrer">
                          {sourceBook.title}
                        </a>
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

      <section className="shelf" aria-label="Books on the shelf">
        <div className="shelf-head">
          <h2>On the shelf</h2>
          <p>Recent books readers are passing around. Pick one to find its neighbors.</p>
        </div>
        <div className="marquee">
          <div className="track">
            {[0, 1].map((copy) =>
              shelf.map((book) => (
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

      <p className="fine">
        Covers and titles come from Open Library and Google Books. Booksrec recommends the book. It does not host the file.
      </p>
      </>
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
}: {
  books: BookMatch[]
  brokenCovers: Record<string, boolean>
  onBroken: (id: string) => void
}) {
  return (
    <ul>
      {books.map((book) => (
        <li key={book.id}>
          <ResultBook book={book} broken={Boolean(brokenCovers[book.id])} onBroken={() => onBroken(book.id)} />
        </li>
      ))}
    </ul>
  )
}

function ResultBook({
  book,
  broken,
  onBroken,
}: {
  book: BookMatch
  broken: boolean
  onBroken: () => void
}) {
  const showBlurb =
    book.description.length > 0 && !book.description.includes(book.why.replace(/…$/, '').slice(0, 48))
  return (
    <article className="result">
      <Cover title={book.title} src={book.coverUrl} broken={broken} onBroken={onBroken} />
      <div>
        <h3>
          <a href={book.infoUrl} target="_blank" rel="noreferrer">
            {book.title}
          </a>
        </h3>
        <p className="meta">{meta(book.authors, book.year)}</p>
        <p className="why">{book.why}</p>
        {showBlurb && <p className="blurb">{book.description}</p>}
      </div>
    </article>
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
