// Confirms a $2 PayPal subscription and stores it on the reader's profile.
// Self-contained so the Vercel bundler does not import another module.

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

export async function handlePaypal(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const userId = await accountId(token)
  if (!userId) return json({ error: 'Sign in before starting the pass.' }, 401)

  let body: { subscriptionId?: string }
  try {
    body = (await request.json()) as { subscriptionId?: string }
  } catch {
    return json({ error: 'That request could not be read.' }, 400)
  }
  const subscriptionId = (body.subscriptionId ?? '').trim()
  if (!/^I-[A-Z0-9]+$/i.test(subscriptionId)) return json({ error: 'PayPal did not return a subscription.' }, 400)

  const access = await paypalAccess()
  if (!access) return json({ error: 'PayPal is not connected yet.' }, 503)
  const sub = await fetch(`https://api-m.paypal.com/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${access}` },
  })
  if (!sub.ok) return json({ error: 'PayPal could not confirm that payment.' }, 402)
  const details = (await sub.json()) as {
    status?: string
    plan_id?: string
    custom_id?: string
    billing_info?: { next_billing_time?: string }
  }
  const plan = readEnv('PAYPAL_PLAN_ID') || 'P-7VP86448GS1036156NLUJWRA'
  if (plan && details.plan_id && details.plan_id !== plan) return json({ error: 'That payment is for a different plan.' }, 402)
  if (details.custom_id && details.custom_id !== userId) return json({ error: 'That payment belongs to another profile.' }, 403)
  if (details.status !== 'ACTIVE' && details.status !== 'APPROVED') {
    return json({ error: 'PayPal has not approved the $2 pass yet.' }, 402)
  }

  const until = details.billing_info?.next_billing_time
    ? new Date(details.billing_info.next_billing_time)
    : new Date(Date.now() + 32 * 24 * 60 * 60 * 1000)
  const url = readEnv('SUPABASE_URL').replace(/\/$/, '')
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  const saved = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      pass_until: until.toISOString(),
      paypal_subscription_id: subscriptionId,
    }),
  })
  if (!saved.ok) return json({ error: 'The pass could not be saved. Run the latest SQL, then try again.' }, 500)
  return json({ until: until.toISOString() })
}

export const config = {
  runtime: 'edge',
}

export default function handler(request: Request): Promise<Response> {
  return handlePaypal(request)
}
