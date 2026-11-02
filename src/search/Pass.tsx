import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { authMessage, supabase } from '../lib/supabase.ts'
import { paypalClientId, paypalPlanId } from './paypal.ts'

type PaypalButtons = {
  render: (node: HTMLElement) => Promise<void>
  close: () => Promise<void>
}

type PaypalApi = {
  Buttons: (options: {
    style?: { shape: 'pill'; color: 'gold'; layout: 'vertical'; label: 'subscribe' }
    createSubscription: (data: unknown, actions: { subscription: { create: (body: { plan_id: string; custom_id: string }) => Promise<string> } }) => Promise<string>
    onApprove: (data: { subscriptionID?: string }) => Promise<void>
    onError: () => void
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
    if (!paypalClientId || window.paypal) return
    let script = document.getElementById('paypal-sdk') as HTMLScriptElement | null
    const done = () => setSdk(true)
    if (!script) {
      script = document.createElement('script')
      script.id = 'paypal-sdk'
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId)}&vault=true&intent=subscription`
      script.onerror = () => setError('PayPal could not be loaded. Try again in a moment.')
      document.body.appendChild(script)
    }
    script.addEventListener('load', done)
    return () => script?.removeEventListener('load', done)
  }, [])

  useEffect(() => {
    const paypal = window.paypal
    if (!sdk || !paypal || !session || !box.current || !paypalPlanId) return
    const node = box.current
    node.replaceChildren()
    let buttons: PaypalButtons | null = null
    let stop = false
    buttons = paypal.Buttons({
      style: { shape: 'pill', color: 'gold', layout: 'vertical', label: 'subscribe' },
      createSubscription: (_data, actions) => actions.subscription.create({ plan_id: paypalPlanId, custom_id: session.user.id }),
      onApprove: async (data) => {
        const response = await fetch('/api/paypal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ subscriptionId: data.subscriptionID ?? '' }),
        })
        const body = (await response.json()) as { error?: string }
        if (!response.ok) {
          setError(body.error || 'The pass could not be saved.')
          return
        }
        readyRef.current()
      },
      onError: () => setError('PayPal did not finish the payment.'),
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
      <p className="meta">Five free searches are included. After that, Booksrec is $2 a month. Cancel any time in PayPal.</p>
      {session ? (
        <div id="paypal-button-container-P-7VP86448GS1036156NLUJWRA" ref={box} />
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
