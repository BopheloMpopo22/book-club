import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// A reset link can arrive as #community&access_token=... The client only
// reads the session when access_token is the first value in the hash.
if (typeof window !== 'undefined') {
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  const tokenAt = raw.indexOf('access_token=')
  if (tokenAt > 0) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${raw.slice(tokenAt)}`)
  }
}

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

export function recoveryOpen(hash = '', search = ''): boolean {
  return (
    hash.includes('type=recovery') ||
    search.includes('type=recovery') ||
    search.includes('token_hash=') ||
    search.includes('code=')
  )
}

export function recoveryLinkError(hash = '', search = ''): string {
  const blob = `${hash}&${search}`
  if (/otp_expired|access_denied|error_description/i.test(blob)) {
    return 'This reset link has expired or was already opened. Request a new one, and open the newest email.'
  }
  return ''
}

export function authMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password do not match.'
  if (/auth session missing/i.test(message)) {
    return 'This reset link has expired or was already opened. Request a new one, and open the newest email.'
  }
  return message
}
