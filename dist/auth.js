// Sign-in via Supabase Auth over REST (no SDK): magic link email, Google OAuth, session refresh.
// The session is stored in localStorage; the access token goes to our server as a Bearer header.

import { session } from './state.js';

const KEY = 'roledone-auth';
let config = null; // { url, anonKey } from /api/status

export function configureAuth(cfg) { config = cfg || null; }
export const authEnabled = () => Boolean(config);

function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function write(s) { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* ignore */ } }

export function currentUser() { return read()?.user || null; }

/** Valid access token, refreshing if it is about to expire. Null when signed out. */
export async function accessToken() {
  const s = read();
  if (!s?.access_token) return null;
  if (s.expires_at && Date.now() > s.expires_at - 60_000 && s.refresh_token && config) {
    try {
      const res = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: config.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
      if (!res.ok) { write(null); return null; }
      store(await res.json());
      return read().access_token;
    } catch { return s.access_token; }
  }
  return s.access_token;
}

function store(tokens) {
  const expiresIn = Number(tokens.expires_in || 3600);
  write({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + expiresIn * 1000, user: tokens.user ? { id: tokens.user.id, email: tokens.user.email } : read()?.user || null });
}

const redirectTo = () => `${location.origin}/`;

/** Email a magic link. Resolves when Supabase accepted the request. */
export async function sendMagicLink(email) {
  if (!config) throw new Error('Sign-in is not enabled on this server.');
  const res = await fetch(`${config.url}/auth/v1/otp`, { method: 'POST', headers: { apikey: config.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ email, create_user: true, options: { email_redirect_to: redirectTo() } }) });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.msg || d.error_description || d.message || 'Could not send the link. Try again in a minute.'); }
}

/** Send the browser to Google via Supabase. */
export function signInWithGoogle() {
  if (!config) throw new Error('Sign-in is not enabled on this server.');
  location.href = `${config.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo())}`;
}

/**
 * Returning from a magic link or Google: Supabase puts tokens in the URL fragment.
 * Returns true when a session was captured (caller cleans the hash and re-renders).
 */
export async function captureSessionFromUrl() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!hash.includes('access_token=')) {
    if (hash.includes('error=')) { const p = new URLSearchParams(hash); throw new Error(p.get('error_description')?.replace(/\+/g, ' ') || 'Sign-in failed.'); }
    return false;
  }
  const p = new URLSearchParams(hash);
  const tokens = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') };
  store(tokens);
  // Fetch the user so we have the email.
  try {
    const res = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.anonKey, Authorization: `Bearer ${tokens.access_token}` } });
    if (res.ok) { const u = await res.json(); const s = read(); write({ ...s, user: { id: u.id, email: u.email } }); }
  } catch { /* keep tokens; user resolved later */ }
  history.replaceState(null, '', location.pathname + '#overview');
  return true;
}

export async function signOut() {
  const s = read();
  write(null);
  session.me = null;
  session.billing = { plan: null, subscribed: false };
  if (s?.access_token && config) { try { await fetch(`${config.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: config.anonKey, Authorization: `Bearer ${s.access_token}` } }); } catch { /* ignore */ } }
}
