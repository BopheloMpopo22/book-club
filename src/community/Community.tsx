import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase.ts'

type Person = { id: string; name: string }

type Post = {
  id: string
  body: string
  created_at: string
  author_id: string
}

type Note = Post & { post_id: string }

type RoomRoute = { kind: 'room'; tag: string } | { kind: 'profile'; id: string }

function readRoom(): RoomRoute {
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
  if (hash.startsWith('profile/')) return { kind: 'profile', id: hash.slice('profile/'.length) }
  const tag = hash.split('/')[1] ?? ''
  return { kind: 'room', tag: tag.toLowerCase() }
}

function tagsOf(text: string): string[] {
  const found = text.match(/#[\p{L}\p{N}_]{2,40}/gu) ?? []
  return [...new Set(found.map((tag) => tag.slice(1).toLowerCase()))]
}

function when(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function personName(people: Record<string, string>, id: string): string {
  return people[id] || 'Reader'
}

function roomError(message: string): string {
  if (/failed to fetch|network/i.test(message)) return 'The conversation could not be loaded. Check the connection and try again.'
  if (/does not exist|schema cache|relation/i.test(message)) {
    return 'The community tables are not in Supabase yet. Run the community SQL, then refresh.'
  }
  return message
}

export default function Community() {
  const [session, setSession] = useState<Session | null>(null)
  const [people, setPeople] = useState<Record<string, string>>({})
  const [posts, setPosts] = useState<Post[]>([])
  const [comments, setComments] = useState<Note[]>([])
  const [route, setRoute] = useState<RoomRoute>(readRoom)
  const [draft, setDraft] = useState('')
  const [replies, setReplies] = useState<Record<string, string>>({})
  const [authMode, setAuthMode] = useState<'in' | 'up'>('up')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const sync = () => setRoute(readRoom())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    if (!supabase || route.kind !== 'profile') return
    const id = route.id
    let stop = false
    void supabase
      .from('member_names')
      .select('id, name')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (stop || !data) return
        const person = data as Person
        setPeople((current) => ({ ...current, [person.id]: person.name }))
      })
      .catch(() => {})
    return () => {
      stop = true
    }
  }, [route])

  useEffect(() => {
    if (!supabase) return
    let stop = false
    async function load() {
      const client = supabase
      if (!client) return
      try {
        const postResult = await client
          .from('posts')
          .select('id, body, created_at, author_id')
          .order('created_at', { ascending: false })
          .limit(80)
        if (stop || postResult.error) {
          if (!stop && postResult.error) setError(roomError(postResult.error.message))
          return
        }
        const nextPosts = (postResult.data ?? []) as Post[]
        const ids = nextPosts.map((post) => post.id)
        const commentResult = ids.length
          ? await client
              .from('comments')
              .select('id, post_id, body, created_at, author_id')
              .in('post_id', ids)
              .order('created_at', { ascending: true })
          : { data: [], error: null }
        if (stop || commentResult.error) {
          if (!stop && commentResult.error) setError(roomError(commentResult.error.message))
          return
        }
        const nextComments = (commentResult.data ?? []) as Note[]
        const authorIds = [...new Set([...nextPosts, ...nextComments].map((item) => item.author_id))]
        const profileResult = authorIds.length
          ? await client.from('member_names').select('id, name').in('id', authorIds)
          : { data: [], error: null }
        if (stop) return
        const nextPeople: Record<string, string> = {}
        for (const person of (profileResult.data ?? []) as Person[]) nextPeople[person.id] = person.name
        setPosts(nextPosts)
        setComments(nextComments)
        setPeople(nextPeople)
        setError('')
      } catch (err) {
        if (!stop) setError(roomError(err instanceof Error ? err.message : 'The conversation could not be loaded.'))
      }
    }
    void load()
    const channel = supabase
      .channel('community-room')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => void load())
      .subscribe()
    return () => {
      stop = true
      void supabase?.removeChannel(channel)
    }
  }, [])

  const counts = new Map<string, number>()
  for (const text of [...posts.map((post) => post.body), ...comments.map((comment) => comment.body)]) {
    for (const tag of tagsOf(text)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  const hashtags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const visible = posts.filter((post) => {
    if (route.kind === 'profile') return post.author_id === route.id
    if (!route.tag) return true
    if (tagsOf(post.body).includes(route.tag)) return true
    return comments.some((comment) => comment.post_id === post.id && tagsOf(comment.body).includes(route.tag))
  })
  const profileName = route.kind === 'profile' ? personName(people, route.id) : ''

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setNotice('')
    setError('')
    if (authMode === 'up') {
      const { data, error: signError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim() },
          emailRedirectTo: `${window.location.origin}/#community`,
        },
      })
      if (signError) setError(signError.message)
      else if (!data.session) setNotice('Check your email to confirm the account, then sign in.')
      else {
        await supabase.from('profiles').upsert({ id: data.session.user.id, email: email.trim(), name: name.trim() })
        setPassword('')
      }
    } else {
      const { error: signError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signError) setError(signError.message)
      else setPassword('')
    }
    setBusy(false)
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!supabase || !session || !body) return
    setBusy(true)
    setError('')
    const { error: writeError } = await supabase.from('posts').insert({ author_id: session.user.id, body })
    if (writeError) setError(writeError.message)
    else setDraft('')
    setBusy(false)
  }

  async function reply(postId: string) {
    const body = (replies[postId] ?? '').trim()
    if (!supabase || !session || !body) return
    setBusy(true)
    setError('')
    const { error: writeError } = await supabase.from('comments').insert({
      post_id: postId,
      author_id: session.user.id,
      body,
    })
    if (writeError) setError(writeError.message)
    else setReplies((current) => ({ ...current, [postId]: '' }))
    setBusy(false)
  }

  async function removePost(id: string) {
    if (!supabase) return
    const { error: writeError } = await supabase.from('posts').delete().eq('id', id)
    if (writeError) setError(writeError.message)
  }

  async function removeComment(id: string) {
    if (!supabase) return
    const { error: writeError } = await supabase.from('comments').delete().eq('id', id)
    if (writeError) setError(writeError.message)
  }

  function openTag(tag: string) {
    window.location.hash = tag ? `community/${encodeURIComponent(tag)}` : 'community'
  }

  if (!supabase) {
    return (
      <section className="community-missing">
        <h2>The community is not connected yet</h2>
        <p>
          Add the Supabase URL and the anon key to the site, then run the community tables from the SQL file. After
          that, readers can sign in with email and the conversation is saved.
        </p>
      </section>
    )
  }

  return (
    <section className="community">
      <div className="feed">
        {route.kind === 'profile' && (
          <div className="profile-head">
            <button type="button" className="quiet" onClick={() => openTag('')}>
              Back to the conversation
            </button>
            <h2>{profileName}</h2>
            {session?.user.id === route.id && <p className="meta">{session.user.email}</p>}
          </div>
        )}

        {!session && route.kind === 'room' && (
          <form className="auth-card" onSubmit={signIn}>
            <h2>{authMode === 'up' ? 'Join the conversation' : 'Welcome back'}</h2>
            <p className="meta">Your name and email are saved with your profile. Anyone can read. Members can post.</p>
            {authMode === 'up' && (
              <label>
                Name
                <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={40} />
              </label>
            )}
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
              />
            </label>
            <button className="solid" type="submit" disabled={busy}>
              {authMode === 'up' ? 'Create profile' : 'Sign in'}
            </button>
            <button type="button" className="quiet" onClick={() => setAuthMode((mode) => (mode === 'up' ? 'in' : 'up'))}>
              {authMode === 'up' ? 'I already have a profile' : 'Create a profile'}
            </button>
          </form>
        )}

        {session && route.kind === 'room' && (
          <form className="composer" onSubmit={publish}>
            <label className="sr-only" htmlFor="post">
              Share with the community
            </label>
            <textarea
              id="post"
              rows={3}
              value={draft}
              maxLength={4000}
              placeholder="What did you love, or what missed? Add #recommendation or a book name so others can find it."
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="solid" type="submit" disabled={busy || !draft.trim()}>
              Post
            </button>
          </form>
        )}

        {notice && <p className="status">{notice}</p>}
        {error && <p className="status">{error}</p>}

        {visible.length === 0 && <p className="meta empty-room">Nothing in this part of the conversation yet.</p>}

        {visible.map((post) => {
          const thread = comments.filter((comment) => comment.post_id === post.id)
          return (
            <article className="post" key={post.id}>
              <header className="post-top">
                <button type="button" className="person" onClick={() => (window.location.hash = `profile/${post.author_id}`)}>
                  {personName(people, post.author_id)}
                </button>
                <span className="meta">{when(post.created_at)}</span>
                {session?.user.id === post.author_id && (
                  <button type="button" className="quiet" onClick={() => void removePost(post.id)}>
                    Delete
                  </button>
                )}
              </header>
              <Talk text={post.body} onTag={openTag} />
              <div className="thread">
                {thread.map((comment) => (
                  <div className="comment" key={comment.id}>
                    <button
                      type="button"
                      className="person"
                      onClick={() => (window.location.hash = `profile/${comment.author_id}`)}
                    >
                      {personName(people, comment.author_id)}
                    </button>
                    <span className="meta">{when(comment.created_at)}</span>
                    <Talk text={comment.body} onTag={openTag} />
                    {session?.user.id === comment.author_id && (
                      <button type="button" className="quiet" onClick={() => void removeComment(comment.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                ))}
                {session && (
                  <form
                    className="reply"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void reply(post.id)
                    }}
                  >
                    <label className="sr-only" htmlFor={`reply-${post.id}`}>
                      Comment
                    </label>
                    <input
                      id={`reply-${post.id}`}
                      value={replies[post.id] ?? ''}
                      maxLength={2000}
                      placeholder="Comment"
                      onChange={(event) => setReplies((current) => ({ ...current, [post.id]: event.target.value }))}
                    />
                    <button className="more" type="submit" disabled={busy || !(replies[post.id] ?? '').trim()}>
                      Comment
                    </button>
                  </form>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <aside className="hashtags" aria-label="Hashtags">
        <h2>Hashtags</h2>
        <button type="button" className={route.kind === 'room' && !route.tag ? 'hash on' : 'hash'} onClick={() => openTag('')}>
          All conversations
        </button>
        {hashtags.length === 0 && <p className="meta">Tags like #recommendation will gather here.</p>}
        {hashtags.map(([tag, count]) => (
          <button
            key={tag}
            type="button"
            className={route.kind === 'room' && route.tag === tag ? 'hash on' : 'hash'}
            onClick={() => openTag(tag)}
          >
            #{tag} <span>{count}</span>
          </button>
        ))}
        {session && (
          <>
            <button type="button" className="quiet sign-out" onClick={() => (window.location.hash = `profile/${session.user.id}`)}>
              Your profile
            </button>
            <button type="button" className="quiet sign-out" onClick={() => void supabase?.auth.signOut()}>
              Sign out
            </button>
          </>
        )}
      </aside>
    </section>
  )
}

function Talk({ text, onTag }: { text: string; onTag: (tag: string) => void }) {
  const parts = text.split(/(#[\p{L}\p{N}_]{2,40})/gu)
  return (
    <p className="talk">
      {parts.map((part, index) =>
        part.startsWith('#') ? (
          <button key={`${part}-${index}`} type="button" className="inline-hash" onClick={() => onTag(part.slice(1).toLowerCase())}>
            {part}
          </button>
        ) : (
          <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>
        ),
      )}
    </p>
  )
}
