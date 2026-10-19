import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { genres, movies, siteLine, siteName, tropes } from './data/discover.ts'
import { shelf } from './data/shelf.ts'
import type { BookMatch, RecommendResponse, ShelfBook } from './types.ts'

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
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [brokenCovers, setBrokenCovers] = useState<Record<string, boolean>>({})
  const busy = useRef(false)

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

  async function search(nextQuery = query) {
    const text = nextQuery.trim()
    if (busy.current) return
    if (!text && pickedGenres.length + pickedTropes.length + pickedMovies.length === 0) return
    busy.current = true
    setQuery(nextQuery)
    setPhase('loading')
    setError('')
    try {
      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          genres: pickedGenres,
          tropes: pickedTropes,
          movies: pickedMovies,
        }),
      })
      const data = (await response.json()) as RecommendResponse
      if (!response.ok) {
        setPhase('ready')
        setBooks([])
        setError(data.error || 'Search failed.')
        return
      }
      setBooks(data.books ?? [])
      setNote(data.note ?? '')
      setPhase('ready')
      if (!data.books?.length) {
        setError('Nothing close enough turned up. Name the hero, the job, or a book it felt like.')
      }
      requestAnimationFrame(() => {
        document.getElementById('matches')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch {
      setPhase('ready')
      setError('Folio could not reach the catalogs. Try again in a moment.')
    } finally {
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
    setNote('')
    setError('')
    setPhase('idle')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="page">
      <header className="top">
        <button type="button" className="mark" onClick={reset}>
          {siteName}
        </button>
        <p className="line">{siteLine}</p>
      </header>

      <main className="stage">
        <form className="search" onSubmit={onSubmit}>
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
              rows={1}
              value={query}
              placeholder="A realistic hero, a job that drives the story, a rainy campus, a movie it felt like…"
              onChange={(event) => {
                const el = event.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`
                setQuery(el.value)
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <button className="send" type="submit" disabled={!canSearch || phase === 'loading'} aria-label="Find books">
            {phase === 'loading' ? <span className="spinner" /> : <ArrowIcon />}
          </button>
        </form>

        <p className="status" role="status">
          {phase === 'loading' ? 'Looking through recent books…' : error}
        </p>

        <section className="filters" aria-label="Ways to describe a book">
          <FilterGroup
            label="Genres"
            options={genres}
            selected={pickedGenres}
            onToggle={(value) => setGenres((current) => toggle(current, value))}
          />
          <FilterGroup
            label="Tropes"
            options={tropes}
            selected={pickedTropes}
            onToggle={(value) => setTropes((current) => toggle(current, value))}
            columns
          />
          <FilterGroup
            label="Movies"
            options={movies}
            selected={pickedMovies}
            onToggle={(value) => setMovies((current) => toggle(current, value))}
          />
        </section>

        {phase !== 'idle' && (
          <section className="matches" id="matches" aria-live="polite">
            {phase === 'loading' && books.length === 0 ? (
              <div className="skeletons" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ) : (
              <>
                {note && books.length > 0 && <h2>{note}</h2>}
                <ul>
                  {books.map((book) => (
                    <li key={book.id}>
                      <ResultBook
                        book={book}
                        broken={Boolean(brokenCovers[book.id])}
                        onBroken={() => setBrokenCovers((current) => ({ ...current, [book.id]: true }))}
                      />
                    </li>
                  ))}
                </ul>
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
        Covers and titles come from Open Library and Google Books. Folio recommends the book. It does not host the file.
      </p>
    </div>
  )
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
  columns = false,
}: {
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  columns?: boolean
}) {
  return (
    <div className="filter">
      <h2 className="filter-label">{label}</h2>
      <div className={columns ? 'choices columns' : 'choices'} role="group" aria-label={label}>
        {options.map((option) => {
          const pressed = selected.includes(option)
          return (
            <button
              key={option}
              type="button"
              className="choice"
              aria-pressed={pressed}
              onClick={() => onToggle(option)}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
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
