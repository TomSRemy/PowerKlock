// ════════════════════════════════════════════════════════════════════
// account.js · window.PKAccount — sign-in and cloud storage (Supabase)
// ────────────────────────────────────────────────────────────────────
// Sign-in by e-mail link (no password). Each user owns one row in
// public.user_dashboards (schema: supabase/schema.sql), protected by
// row-level security, so a user only ever reads and writes their own row.
//
// The project URL and publishable key below are public by design: the key
// only grants what the RLS policies allow. Leave them empty and
// the site keeps working with browser-only storage.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const CONFIG = {
    url: 'https://xtqeslyjtjrbjpffpixn.supabase.co',
    anonKey: 'sb_publishable_mfgTs1zA6ZT69hU0DhXpnA_YmjpkRQ1',   // publishable key: RLS decides access
  };
  const SDK = 'js/vendor/supabase.min.js';
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

  // Shared dashboard links (#solo=<id>): no sign-in needed, read by anyone with the
  // id, republished only by whoever holds the edit_token (schema: supabase/schema.sql).
  async function sharedCreate(data) {
    await ready();
    if (!client) throw new Error('Sharing is not configured yet.');
    const { data: rows, error } = await client.rpc('create_shared_board', { p_data: data });
    if (error) throw error;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('No id returned.');
    return { id: row.id, token: row.edit_token };
  }

  async function sharedUpdate(id, token, data) {
    await ready();
    if (!client) throw new Error('Sharing is not configured yet.');
    const { data: ok, error } = await client.rpc('update_shared_board', { p_id: id, p_token: token, p_data: data });
    if (error) throw error;
    return !!ok;
  }

  async function sharedGet(id) {
    await ready();
    if (!client) throw new Error('Sharing is not configured yet.');
    const { data, error } = await client.from('shared_boards').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  }

  window.PKAccount = {
    configured,
    ready, signIn, signOut, load, save,
    sharedCreate, sharedUpdate, sharedGet,
    get user() { return user; },
    client: () => client,   // supabase-js client (RLS applies), null until ready()
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
})();
