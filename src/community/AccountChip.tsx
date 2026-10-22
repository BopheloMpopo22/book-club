import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.ts'

export default function AccountChip() {
  const [id, setId] = useState<string | null>(null)
  const [label, setLabel] = useState('Reader')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let stop = false

    async function paint(userId: string, email: string) {
      let name = email.split('@')[0] || 'Reader'
      let avatar: string | null = null
      let result = await client.from('profiles').select('name, avatar_url').eq('id', userId).maybeSingle()
      if (result.error) result = await client.from('profiles').select('name').eq('id', userId).maybeSingle()
      const row = result.data as { name?: string; avatar_url?: string | null } | null
      if (row?.name) name = row.name
      if (row?.avatar_url) avatar = row.avatar_url
      if (stop) return
      setId(userId)
      setLabel(name)
      setUrl(avatar)
    }

    function show(userId: string | undefined, email: string | undefined) {
      if (!userId) {
        setId(null)
        setUrl(null)
        return
      }
      void paint(userId, email ?? '')
    }

    void client.auth.getSession().then(({ data }) => show(data.session?.user.id, data.session?.user.email))
    const { data } = client.auth.onAuthStateChange((_event, session) => show(session?.user.id, session?.user.email))
    const refresh = () => {
      void client.auth.getSession().then(({ data }) => show(data.session?.user.id, data.session?.user.email))
    }
    window.addEventListener('profile-updated', refresh)
    return () => {
      stop = true
      data.subscription.unsubscribe()
      window.removeEventListener('profile-updated', refresh)
    }
  }, [])

  if (!id) return null
  const letter = (label.trim()[0] || 'R').toUpperCase()

  return (
    <button
      type="button"
      className="account-chip"
      aria-label={`${label} profile`}
      onClick={() => {
        window.location.hash = `profile/${id}`
      }}
    >
      <span className="avatar">{url ? <img src={url} alt="" /> : letter}</span>
    </button>
  )
}
