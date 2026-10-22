import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { catalog, type CatalogBook } from '../data/catalog.ts'
import { supabase } from '../lib/supabase.ts'

type Rating = { author_id: string; book_id: string; stars: number; reason: string }

const genres = [...new Set(catalog.flatMap((book) => book.genres))].sort((a, b) => a.localeCompare(b))

export default function BookRail({ session, readerName }: { session: Session | null; readerName: string }) {
  const list = useRef<HTMLDivElement>(null)
  const [genre, setGenre] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [stars, setStars] = useState<Record<string, number>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [ratings, setRatings] = useState<Rating[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const books = useMemo(() => {
    return catalog
      .filter((book) => !genre || book.genres.includes(genre))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title))
  }, [genre])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let stop = false
    async function load() {
      const result = await client.from('book_ratings').select('author_id, book_id, stars, reason').limit(1000)
      if (stop || result.error) return
      const rows = (result.data ?? []) as Rating[]
      setRatings(rows)
      if (session) {
        const mine: Record<string, number> = {}
        const notes: Record<string, string> = {}
        for (const row of rows) {
          if (row.author_id !== session.user.id) continue
          mine[row.book_id] = row.stars
          if (row.reason) notes[row.book_id] = row.reason
        }
        setStars((current) => ({ ...mine, ...current }))
        setReasons((current) => ({ ...notes, ...current }))
      }
    }
    void load()
    const channel = client
      .channel('book-ratings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'book_ratings' }, () => void load())
      .subscribe()
    return () => {
      stop = true
      void client.removeChannel(channel)
    }
  }, [session])

  function score(bookId: string) {
    const rows = ratings.filter((row) => row.book_id === bookId)
    if (rows.length === 0) return null
    const total = rows.reduce((sum, row) => sum + row.stars, 0)
    return { count: rows.length, average: total / rows.length }
  }

  async function share(book: CatalogBook) {
    if (!supabase || !session) {
      setNote('Sign in to rate a book.')
      return
    }
    const rating = stars[book.id]
    if (!rating) return
    const reason = (reasons[book.id] ?? '').trim()
    const mine = ratings.find((row) => row.author_id === session.user.id && row.book_id === book.id)
    setBusy(true)
    setNote('')
    const saved = await supabase.from('book_ratings').upsert(
      { author_id: session.user.id, book_id: book.id, title: book.title, stars: rating, reason },
      { onConflict: 'author_id,book_id' },
    )
    if (saved.error) {
      setNote(
        /does not exist|schema cache|book_ratings/i.test(saved.error.message)
          ? 'Run the latest community SQL, then ratings can be saved.'
          : saved.error.message,
      )
      setBusy(false)
      return
    }
    if (reason && reason !== (mine?.reason ?? '')) {
      const body = `${readerName || 'A reader'} rated ${book.title} ${rating} out of 5. ${reason}`
      const posted = await supabase.from('posts').insert({ author_id: session.user.id, body })
      setNote(posted.error ? posted.error.message : 'Shared with the community.')
    } else {
      setNote('Rating saved.')
    }
    setBusy(false)
  }

  return (
    <div className="book-rail">
      <div className="rail-head">
        <h2>Books</h2>
        <label className="sr-only" htmlFor="rail-genre">
          Genre
        </label>
        <select id="rail-genre" value={genre} onChange={(event) => setGenre(event.target.value)}>
          <option value="">All genres</option>
          {genres.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="rail-arrow" aria-label="Newer books" onClick={() => list.current?.scrollBy({ top: -180, behavior: 'smooth' })}>
        ⌃
      </button>
      <div className="rail-list" ref={list}>
        {books.map((book) => {
          const summary = score(book.id)
          const open = picked === book.id
          const rating = stars[book.id] ?? 0
          return (
            <article className={open ? 'rail-book open' : 'rail-book'} key={book.id}>
              <button type="button" className="rail-pick" onClick={() => setPicked(open ? null : book.id)}>
                <img src={book.coverUrl} alt="" />
                <span>
                  <strong>{book.title}</strong>
                  <em>
                    {book.authors[0]}
                    {book.year ? ` · ${book.year}` : ''}
                  </em>
                  <small>{summary ? `${summary.average.toFixed(1)} · ${summary.count}` : 'No ratings yet'}</small>
                </span>
              </button>
              {open && (
                <div className="rail-rate">
                  <div className="stars" role="group" aria-label={`Rate ${book.title}`}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={value <= rating ? 'star on' : 'star'}
                        aria-label={`${value} out of 5`}
                        onClick={() => setStars((current) => ({ ...current, [book.id]: value }))}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <label className="sr-only" htmlFor={`reason-${book.id}`}>
                    Reason
                  </label>
                  <textarea
                    id={`reason-${book.id}`}
                    rows={3}
                    maxLength={500}
                    placeholder="Why this rating? It will join the conversation."
                    value={reasons[book.id] ?? ''}
                    onChange={(event) => setReasons((current) => ({ ...current, [book.id]: event.target.value }))}
                  />
                  <button type="button" className="solid" disabled={busy || !rating} onClick={() => void share(book)}>
                    {(reasons[book.id] ?? '').trim() ? 'Share' : 'Save stars'}
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>
      <button type="button" className="rail-arrow" aria-label="Older books" onClick={() => list.current?.scrollBy({ top: 180, behavior: 'smooth' })}>
        ⌄
      </button>
      {note && <p className="meta">{note}</p>}
    </div>
  )
}
