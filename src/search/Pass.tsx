import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { authMessage, supabase } from '../lib/supabase.ts'
import { paypalClientId } from './paypal.ts'

type PaypalButtons = {
  render: (node: HTMLElement) => Promise<void>
  close: () => Promise<void>
}

type PaypalApi = {
  Buttons: (options: {
    style?: { shape: 'pill'; color: 'gold'; layout: 'vertical'; label: 'pay' }
    createOrder: () => Promise<string>
    onApprove: (data: { orderID?: string }) => Promise<void>
    onError: (error?: unknown) => void
    onCancel: () => void
  }) => PaypalButtons
}

export default function Pass({ onClose, onReady }: { onClose: () => void; onReady: () => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const readyRef = useRef(onReady)
  useEffect(() => {
    readyRef.current = onReady
  })
  const [sdk, setSdk] = useState(() => Boolean(window.paypal))
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    void client.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!paypalClientId) return
    const src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId)}&currency=USD&intent=capture&enable-funding=card&disable-funding=paylater,venmo,credit`
    let script = document.getElementById('paypal-sdk') as HTMLScriptElement | null
    if (script && !script.src.includes('intent=capture')) {
      script.remove()
      delete window.paypal
      script = null
    }
    const done = () => setSdk(true)
    if (!script) {
      script = document.createElement('script')
      script.id = 'paypal-sdk'
      script.src = src
      script.onerror = () => setError('PayPal could not be loaded. Try again in a moment.')
      document.body.appendChild(script)
    }
    if (window.paypal) return
    script.addEventListener('load', done)
    return () => script?.removeEventListener('load', done)
  }, [])

  useEffect(() => {
    const paypal = window.paypal
    if (!sdk || !paypal || !session || !box.current) return
    const node = box.current
    node.replaceChildren()
    let buttons: PaypalButtons | null = null
    let stop = false
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    }
    buttons = paypal.Buttons({
      style: { shape: 'pill', color: 'gold', layout: 'vertical', label: 'pay' },
      createOrder: async () => {
        const response = await fetch('/api/paypal', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'create' }),
        })
        const body = (await response.json()) as { orderId?: string; error?: string }
        if (!response.ok || !body.orderId) {
          setError(body.error || 'PayPal could not start the payment.')
          throw new Error('create')
        }
        return body.orderId
      },
      onApprove: async (data) => {
        const response = await fetch('/api/paypal', {
          method: 'POST',
          headers,
          body: JSON.stringify({ orderId: data.orderID ?? '' }),
        })
        const body = (await response.json()) as { error?: string }
        if (!response.ok) {
          setError(body.error || 'The pass could not be saved.')
          return
        }
        readyRef.current()
      },
      onCancel: () => setError('The payment window was closed before it finished.'),
      onError: (error) => {
        const detail = error instanceof Error ? error.message : ''
        setError((current) => current || (detail && detail !== 'create' && detail.length < 180 ? detail : 'PayPal could not open the payment.'))
      },
    })
    void buttons.render(node).catch(() => {
      if (!stop) setError('PayPal could not be shown.')
    })
    return () => {
      stop = true
      void buttons?.close()
    }
  }, [sdk, session])

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error: signError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (signError) setError(authMessage(signError.message))
    else setPassword('')
    setBusy(false)
  }

  return (
    <section className="auth-card pass-card">
      <h2>Keep searching</h2>
      <p className="meta">Five free searches are included. After that, $2 pays for 30 days. Use a card, or PayPal if you already have it. It does not renew.</p>
      {session ? (
        <div id="paypal-button-container" ref={box} />
      ) : (
        <form onSubmit={signIn}>
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} />
          </label>
          <button className="solid" type="submit" disabled={busy}>
            Sign in
          </button>
          <button type="button" className="quiet" onClick={() => { window.location.hash = 'community' }}>
            Create a profile
          </button>
        </form>
      )}
      {error && <p className="status">{error}</p>}
      <button type="button" className="quiet" onClick={onClose}>
        Not now
      </button>
    </section>
  )
}

declare global {
  interface Window {
    paypal?: PaypalApi
  }
}
