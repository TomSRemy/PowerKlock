// ════════════════════════════════════════════════════════════════════
// account.js · window.PKAccount — sign-in and cloud storage (Supabase)
// ────────────────────────────────────────────────────────────────────
// Sign-in by e-mail link (no password). Each user owns one row in
// public.user_dashboards (schema: supabase/schema.sql), protected by
// row-level security, so a user only ever reads and writes their own row.
//
// The project URL and anon key below are public by design: Supabase's
// anon key only grants what the RLS policies allow. Leave them empty and
// the site keeps working with browser-only storage.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const CONFIG = {
    url: '',        // https://<project>.supabase.co
    anonKey: '',    // Project Settings → API → anon public
  };
  const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  const TABLE = 'user_dashboards';

  const configured = !!(CONFIG.url && CONFIG.anonKey);
  let client = null, user = null, readyP = null;
  const subs = new Set();

  function loadSdk() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = SDK; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('Supabase SDK failed to load'));
      document.head.appendChild(s);
    });
  }

  function emit() { subs.forEach(fn => { try { fn(user); } catch (e) { console.warn(e); } }); }

  function ready() {
    if (!configured) return Promise.resolve(null);
    if (readyP) return readyP;
    readyP = loadSdk().then(async () => {
      client = window.supabase.createClient(CONFIG.url, CONFIG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const { data } = await client.auth.getSession();
      user = data && data.session ? data.session.user : null;
      client.auth.onAuthStateChange((_ev, session) => {
        const next = session ? session.user : null;
        if ((next && next.id) !== (user && user.id)) { user = next; emit(); }
      });
      return user;
    }).catch(e => { console.warn('[PKAccount]', e); return null; });
    return readyP;
  }

  async function signIn(email) {
    await ready();
    if (!client) throw new Error('Accounts are not configured yet.');
    const { error } = await client.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }

  async function signOut() {
    await ready();
    if (client) await client.auth.signOut();
    user = null; emit();
  }

  // → { data, updated_at } or null when the user has no saved row yet.
  async function load() {
    await ready();
    if (!client || !user) return null;
    const { data, error } = await client.from(TABLE).select('data, updated_at').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function save(payload) {
    await ready();
    if (!client || !user) return false;
    const { error } = await client.from(TABLE).upsert({ user_id: user.id, data: payload, updated_at: new Date().toISOString() });
    if (error) throw error;
    return true;
  }

  window.PKAccount = {
    configured,
    ready, signIn, signOut, load, save,
    get user() { return user; },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
})();
