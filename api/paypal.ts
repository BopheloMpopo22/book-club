// Confirms a one-time $2 PayPal payment and stores 30 days on the reader's profile.
// Self-contained so the Vercel bundler does not import another module.

const PASS_DAYS = 30

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

async function accountId(token: string): Promise<string> {
  const url = readEnv('SUPABASE_URL').replace(/\/$/, '')
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!token || !url || !key) return ''
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return ''
  const body = (await response.json()) as { id?: string }
  return body.id ?? ''
}

async function paypalAccess(): Promise<string> {
  const id = readEnv('PAYPAL_CLIENT_ID')
  const secret = readEnv('PAYPAL_CLIENT_SECRET')
  if (!id || !secret) return ''
  const response = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!response.ok) return ''
  const body = (await response.json()) as { access_token?: string }
  return body.access_token ?? ''
}

type PaypalOrder = {
  id?: string
  status?: string
  purchase_units?: {
    custom_id?: string
    amount?: { currency_code?: string; value?: string }
    payments?: { captures?: { status?: string; amount?: { currency_code?: string; value?: string } }[] }
  }[]
  details?: { issue?: string }[]
}

function paidOrder(details: PaypalOrder, userId: string): boolean {
  const unit = details.purchase_units?.[0]
  const capture = unit?.payments?.captures?.find((item) => item.status === 'COMPLETED') ?? unit?.payments?.captures?.[0]
  const amount = capture?.amount ?? unit?.amount
  return (
    details.status === 'COMPLETED' &&
    amount?.currency_code === 'USD' &&
    Number(amount.value) === 2 &&
    unit?.custom_id === userId
  )
}

async function createOrder(userId: string, access: string): Promise<Response> {
  const response = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          description: 'Booksrec for 30 days',
          custom_id: userId,
          amount: { currency_code: 'USD', value: '2.00' },
        },
      ],
      application_context: {
        brand_name: 'Booksrec',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    }),
  })
  const details = (await response.json()) as PaypalOrder
  if (!response.ok || !details.id) return json({ error: 'PayPal could not start the payment.' }, 502)
  return json({ orderId: details.id })
}

async function savePass(userId: string, orderId: string): Promise<Response> {
  const url = readEnv('SUPABASE_URL').replace(/\/$/, '')
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  const read = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=pass_until`, { headers })
  let start = Date.now()
  if (read.ok) {
    const rows = (await read.json()) as { pass_until?: string | null }[]
    const current = rows[0]?.pass_until ? new Date(rows[0].pass_until).getTime() : 0
    if (current > start) start = current
  }
  const until = new Date(start + PASS_DAYS * 24 * 60 * 60 * 1000)
  const saved = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ pass_until: until.toISOString(), paypal_subscription_id: orderId }),
  })
  if (!saved.ok) return json({ error: 'The pass could not be saved. Run the latest SQL, then try again.' }, 500)
  return json({ until: until.toISOString() })
}

export async function handlePaypal(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const userId = await accountId(token)
  if (!userId) return json({ error: 'Sign in before starting the pass.' }, 401)
  const access = await paypalAccess()
  if (!access) return json({ error: 'PayPal is not connected yet.' }, 503)

  let body: { action?: string; orderId?: string }
  try {
    body = (await request.json()) as { action?: string; orderId?: string }
  } catch {
    return json({ error: 'That request could not be read.' }, 400)
  }
  if (body.action === 'create') return createOrder(userId, access)

  const orderId = (body.orderId ?? '').trim()
  if (!/^[A-Z0-9]{10,20}$/i.test(orderId)) return json({ error: 'PayPal did not return a payment.' }, 400)
  const captured = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
  })
  let details = (await captured.json()) as PaypalOrder
  const already = details.details?.some((item) => item.issue === 'ORDER_ALREADY_CAPTURED')
  if (!captured.ok && already) {
    const existing = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    if (existing.ok) details = (await existing.json()) as PaypalOrder
  } else if (!captured.ok) {
    return json({ error: 'PayPal could not confirm that payment.' }, 402)
  }
  if (!paidOrder(details, userId)) return json({ error: 'PayPal has not approved the $2 pass yet.' }, 402)
  return savePass(userId, orderId)
}

export const config = {
  runtime: 'edge',
}

export default function handler(request: Request): Promise<Response> {
  return handlePaypal(request)
}
