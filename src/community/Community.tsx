import { useEffect, useState, type FormEvent } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase.ts'

const ROOM_PAGE = 20

type Person = { id: string; name: string; avatar_url?: string | null }

type RowPage<T> = { data: T[] | null; error: { message: string } | null }

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

function personName(people: Record<string, Person>, id: string): string {
  return people[id]?.name || 'Reader'
}

async function everyRow<T>(load: (from: number, to: number) => PromiseLike<RowPage<T>>): Promise<RowPage<T>> {
  const size = 1000
  const rows: T[] = []
  for (let from = 0; ; from += size) {
    const result = await load(from, from + size - 1)
    if (result.error) return { data: null, error: result.error }
    const chunk = result.data ?? []
    rows.push(...chunk)
    if (chunk.length < size) return { data: rows, error: null }
  }
}

async function loadPeople(client: SupabaseClient, ids: string[]): Promise<{ people: Record<string, Person>; error: { message: string } | null }> {
  const people: Record<string, Person> = {}
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100)
    const withPicture = await client.from('member_names').select('id, name, avatar_url').in('id', chunk)
    const result =
      withPicture.error && /avatar_url/i.test(withPicture.error.message)
        ? await client.from('member_names').select('id, name').in('id', chunk)
        : withPicture
    if (result.error) return { people, error: result.error }
    for (const person of (result.data ?? []) as Person[]) {
      people[person.id] = { id: person.id, name: person.name, avatar_url: person.avatar_url ?? null }
    }
  }
  return { people, error: null }
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
  const [people, setPeople] = useState<Record<string, Person>>({})
  const [posts, setPosts] = useState<Post[]>([])
  const [comments, setComments] = useState<Note[]>([])
  const [shownFor, setShownFor] = useState('')
  const [shownCount, setShownCount] = useState(ROOM_PAGE)
  const [host, setHost] = useState(false)
  const [recovery, setRecovery] = useState(() => window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery'))
  const [route, setRoute] = useState<RoomRoute>(readRoom)
  const [draft, setDraft] = useState('')
  const [replies, setReplies] = useState<Record<string, string>>({})
  const [authMode, setAuthMode] = useState<'in' | 'up' | 'forgot'>('up')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let stop = false
    async function readHost(userId: string) {
      const result = await client.from('profiles').select('is_owner').eq('id', userId).maybeSingle()
      if (stop || result.error) return
      setHost(Boolean((result.data as { is_owner?: boolean } | null)?.is_owner))
    }
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) void readHost(data.session.user.id)
    })
    const { data } = client.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (next) void readHost(next.user.id)
      else setHost(false)
    })
    return () => {
      stop = true
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const sync = () => setRoute(readRoom())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    if (!supabase || route.kind !== 'profile') return
    const client = supabase
    const id = route.id
    let stop = false
    void (async () => {
      try {
        const { data } = await client.from('member_names').select('id, name, avatar_url').eq('id', id).maybeSingle()
        if (stop || !data) return
        const person = data as Person
        setPeople((current) => ({
          ...current,
          [person.id]: { id: person.id, name: person.name, avatar_url: person.avatar_url ?? null },
        }))
      } catch {
        try {
          const { data } = await client.from('member_names').select('id, name').eq('id', id).maybeSingle()
          if (stop || !data) return
          const person = data as Person
          setPeople((current) => ({ ...current, [person.id]: { id: person.id, name: person.name, avatar_url: null } }))
        } catch {
          // A missing name leaves the fallback label.
        }
      }
    })()
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
        const postResult = await everyRow<Post>((from, to) =>
          client
            .from('posts')
            .select('id, body, created_at, author_id')
            .order('created_at', { ascending: false })
            .range(from, to),
        )
        if (stop || postResult.error) {
          if (!stop && postResult.error) setError(roomError(postResult.error.message))
          return
        }
        const nextPosts = postResult.data ?? []
        const commentResult = await everyRow<Note>((from, to) =>
          client
            .from('comments')
            .select('id, post_id, body, created_at, author_id')
            .order('created_at', { ascending: true })
            .range(from, to),
        )
        if (stop || commentResult.error) {
          if (!stop && commentResult.error) setError(roomError(commentResult.error.message))
          return
        }
        const nextComments = commentResult.data ?? []
        const authorIds = [...new Set([...nextPosts, ...nextComments].map((item) => item.author_id))]
        const profileResult = await loadPeople(client, authorIds)
        if (stop) return
        if (profileResult.error) {
          setError(roomError(profileResult.error.message))
          return
        }
        setPosts(nextPosts)
        setComments(nextComments)
        setPeople(profileResult.people)
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
  const matched = posts.filter((post) => {
    if (route.kind === 'profile') return post.author_id === route.id
    if (!route.tag) return true
    if (tagsOf(post.body).includes(route.tag)) return true
    return comments.some((comment) => comment.post_id === post.id && tagsOf(comment.body).includes(route.tag))
  })
  const routeKey = route.kind === 'profile' ? `profile/${route.id}` : `room/${route.tag}`
  const shown = shownFor === routeKey ? shownCount : ROOM_PAGE
  const visible = matched.slice(0, shown)
  const profileName = route.kind === 'profile' ? personName(people, route.id) : ''
  const ownProfile = route.kind === 'profile' && session?.user.id === route.id

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setNotice('')
    setError('')
    if (authMode === 'forgot') {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/#community`,
      })
      if (resetError) setError(resetError.message)
      else setNotice('Check your email for a link to choose a new password.')
      setBusy(false)
      return
    }
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

  async function choosePassword(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (nextPassword !== repeatPassword) {
      setError('Those passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password: nextPassword })
    if (updateError) setError(updateError.message)
    else {
      setNextPassword('')
      setRepeatPassword('')
      setRecovery(false)
      setNotice('Your password is updated.')
      window.location.hash = 'community'
    }
    setBusy(false)
  }

  function rememberPerson(id: string, nextName: string, avatarUrl: string | null) {
    setPeople((current) => ({ ...current, [id]: { id, name: nextName, avatar_url: avatarUrl } }))
    window.dispatchEvent(new Event('profile-updated'))
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
            {ownProfile && session ? (
              <ProfileEditor
                key={`${people[session.user.id]?.name ?? ''}:${people[session.user.id]?.avatar_url ?? ''}`}
                email={session.user.email ?? ''}
                name={people[session.user.id]?.name ?? ''}
                avatarUrl={people[session.user.id]?.avatar_url ?? null}
                host={host}
                onSaved={(nextName, avatarUrl) => rememberPerson(session.user.id, nextName, avatarUrl)}
              />
            ) : (
              <>
                <Avatar name={profileName} url={route.kind === 'profile' ? people[route.id]?.avatar_url : null} large />
                <h2>{profileName}</h2>
              </>
            )}
          </div>
        )}

        {recovery && (
          <form className="auth-card" onSubmit={choosePassword}>
            <h2>Choose a new password</h2>
            <label>
              New password
              <input
                type="password"
                value={nextPassword}
                onChange={(event) => setNextPassword(event.target.value)}
                required
                minLength={6}
              />
            </label>
            <label>
              Repeat password
              <input
                type="password"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                required
                minLength={6}
              />
            </label>
            <button className="solid" type="submit" disabled={busy}>
              Save password
            </button>
          </form>
        )}

        {!session && route.kind === 'room' && !recovery && (
          <form className="auth-card" onSubmit={signIn}>
            <h2>{authMode === 'up' ? 'Join the conversation' : authMode === 'forgot' ? 'Reset your password' : 'Welcome back'}</h2>
            <p className="meta">
              {authMode === 'forgot'
                ? 'We will email you a link back to this page.'
                : 'Your name and email are saved with your profile. Anyone can read. Members can post.'}
            </p>
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
            {authMode !== 'forgot' && (
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
            )}
            <button className="solid" type="submit" disabled={busy}>
              {authMode === 'up' ? 'Create profile' : authMode === 'forgot' ? 'Send reset link' : 'Sign in'}
            </button>
            {authMode === 'in' && (
              <button type="button" className="quiet" onClick={() => setAuthMode('forgot')}>
                Forgot password
              </button>
            )}
            {authMode === 'forgot' ? (
              <button type="button" className="quiet" onClick={() => setAuthMode('in')}>
                Back to sign in
              </button>
            ) : (
              <button type="button" className="quiet" onClick={() => setAuthMode((mode) => (mode === 'up' ? 'in' : 'up'))}>
                {authMode === 'up' ? 'I already have a profile' : 'Create a profile'}
              </button>
            )}
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
                  <Avatar name={personName(people, post.author_id)} url={people[post.author_id]?.avatar_url} />
                  {personName(people, post.author_id)}
                </button>
                <span className="meta">{when(post.created_at)}</span>
                {(session?.user.id === post.author_id || host) && (
                  <button type="button" className="quiet" onClick={() => void removePost(post.id)}>
                    {session?.user.id === post.author_id ? 'Delete' : 'Remove'}
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
                      <Avatar name={personName(people, comment.author_id)} url={people[comment.author_id]?.avatar_url} />
                      {personName(people, comment.author_id)}
                    </button>
                    <span className="meta">{when(comment.created_at)}</span>
                    <Talk text={comment.body} onTag={openTag} />
                    {(session?.user.id === comment.author_id || host) && (
                      <button type="button" className="quiet" onClick={() => void removeComment(comment.id)}>
                        {session?.user.id === comment.author_id ? 'Delete' : 'Remove'}
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
        {shown < matched.length && (
          <button
            type="button"
            className="solid"
            onClick={() => {
              setShownFor(routeKey)
              setShownCount(shown + ROOM_PAGE)
            }}
          >
            More
          </button>
        )}
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

function Avatar({ name, url, large }: { name: string; url?: string | null; large?: boolean }) {
  const letter = (name.trim()[0] || 'R').toUpperCase()
  return (
    <span className={large ? 'avatar lg' : 'avatar'}>
      {url ? <img src={url} alt="" /> : letter}
    </span>
  )
}

function ProfileEditor({
  email,
  name,
  avatarUrl,
  host,
  onSaved,
}: {
  email: string
  name: string
  avatarUrl: string | null
  host: boolean
  onSaved: (name: string, avatarUrl: string | null) => void
}) {
  const [nextName, setNextName] = useState(name)
  const [nextEmail, setNextEmail] = useState(email)
  const [nextPassword, setNextPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [picture, setPicture] = useState(avatarUrl)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')
  const [working, setWorking] = useState(false)

  async function saveName(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id
    const trimmed = nextName.trim()
    if (!userId || !trimmed) return
    setWorking(true)
    setProblem('')
    setNote('')
    const { error: writeError } = await supabase.from('profiles').update({ name: trimmed }).eq('id', userId)
    if (writeError) setProblem(writeError.message)
    else {
      await supabase.auth.updateUser({ data: { name: trimmed } })
      onSaved(trimmed, picture)
      setNote('Name saved.')
    }
    setWorking(false)
  }

  async function saveEmail(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setWorking(true)
    setProblem('')
    setNote('')
    const { error: writeError } = await supabase.auth.updateUser({ email: nextEmail.trim() })
    if (writeError) setProblem(writeError.message)
    else {
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user.id
      if (userId) await supabase.from('profiles').update({ email: nextEmail.trim() }).eq('id', userId)
      setNote('Check the new email to confirm the change. Until then, sign in with the current one.')
    }
    setWorking(false)
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (nextPassword !== repeatPassword) {
      setProblem('Those passwords do not match.')
      return
    }
    setWorking(true)
    setProblem('')
    setNote('')
    const { error: writeError } = await supabase.auth.updateUser({ password: nextPassword })
    if (writeError) setProblem(writeError.message)
    else {
      setNextPassword('')
      setRepeatPassword('')
      setNote('Password saved.')
    }
    setWorking(false)
  }

  async function savePicture(file: File) {
    if (!supabase) return
    if (!file.type.startsWith('image/')) {
      setProblem('Choose a picture.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setProblem('Use a picture smaller than 2 MB.')
      return
    }
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id
    if (!userId) return
    setWorking(true)
    setProblem('')
    setNote('')
    const uploaded = await supabase.storage.from('avatars').upload(`${userId}/avatar`, file, {
      upsert: true,
      contentType: file.type,
    })
    if (uploaded.error) {
      setProblem(uploaded.error.message)
      setWorking(false)
      return
    }
    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(`${userId}/avatar`)
    const url = `${publicUrl.publicUrl}?v=${Date.now()}`
    const saved = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId)
    if (saved.error) setProblem(saved.error.message)
    else {
      setPicture(url)
      onSaved(nextName.trim() || name, url)
      setNote('Picture saved.')
    }
    setWorking(false)
  }

  const shownName = name || 'Reader'

  return (
    <>
      <label className="avatar-pick">
        <Avatar name={shownName} url={picture} large />
        <span className="sr-only">Profile picture</span>
        <input
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void savePicture(file)
          }}
        />
      </label>
      <h2>{shownName}</h2>
      <p className="meta">{email}</p>
      <p className="meta">Click the circle to add a picture.</p>
      {host && <p className="meta">You can remove any post in this community.</p>}
      <div className="profile-editor">
        <form onSubmit={saveName}>
          <label>
            Name
            <input value={nextName} onChange={(event) => setNextName(event.target.value)} required maxLength={40} />
          </label>
          <button className="solid" type="submit" disabled={working}>
            Save name
          </button>
        </form>
        <form onSubmit={saveEmail}>
          <label>
            Email
            <input type="email" value={nextEmail} onChange={(event) => setNextEmail(event.target.value)} required />
          </label>
          <button className="solid" type="submit" disabled={working}>
            Save email
          </button>
        </form>
        <form onSubmit={savePassword}>
          <label>
            New password
            <input
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              required
              minLength={6}
            />
          </label>
          <label>
            Repeat password
            <input
              type="password"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              required
              minLength={6}
            />
          </label>
          <button className="solid" type="submit" disabled={working}>
            Save password
          </button>
        </form>
        {note && <p className="status">{note}</p>}
        {problem && <p className="status">{problem}</p>}
      </div>
    </>
  )
}
