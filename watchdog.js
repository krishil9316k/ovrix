import tls from 'node:tls';

const MIN = 60_000;
const HOUR = 60 * MIN;
const RLS_TABLES = ['leads', 'tasks', 'agent_logs', 'approvals', 'payments'];

// Patterns for secrets that must never appear in a public page. We report the NAME only, never the value.
const LEAK_PATTERNS = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{10,}/],
  ['Stripe live secret key', /[sr]k_live_[A-Za-z0-9]{10,}/],
  ['Discord webhook URL', /discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/],
  ['Discord bot token', /[MNO][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,}/],
  ['Google/Gemini API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Razorpay live key', /rzp_live_[A-Za-z0-9]{10,}/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

/** Scan page text for leaked secrets. Returns a list of names (never the secrets themselves). */
export function scanLeaks(text) {
  const found = [];
  for (const [name, re] of LEAK_PATTERNS) if (re.test(text)) found.push(name);
  // Supabase legacy keys are JWTs; the anon one is fine to publish but service_role is not.
  for (const tok of text.match(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g) || []) {
    try {
      const payload = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString('utf8'));
      if (payload?.role === 'service_role') {
        found.push('Supabase service_role key');
        break;
      }
    } catch {
      /* not a JWT we can read */
    }
  }
  return found;
}

/**
 * Anonymous read probe. Sends ONLY the apikey header (no Authorization), exactly like a stranger using
 * the publishable key from the website. Any rows coming back means row-level security is leaking data.
 */
export async function probeRls({ fetchImpl, supabaseUrl, key, tables = RLS_TABLES }) {
  const leaking = [];
  const errors = [];
  for (const t of tables) {
    try {
      const res = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${t}?select=*&limit=1`, {
        headers: { apikey: key },
      });
      if (res.status === 200) {
        const body = await res.json().catch(() => null);
        if (Array.isArray(body) && body.length > 0) leaking.push(t);
      } else if (![401, 403, 404].includes(res.status)) {
        errors.push(`${t}: HTTP ${res.status}`);
      }
    } catch (err) {
      errors.push(`${t}: ${err?.message || err}`);
    }
  }
  return { leaking, errors };
}

/** Days until the site's TLS certificate expires. */
export function tlsDaysLeft(hostname, port = 443) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.valid_to) return reject(new Error('no certificate'));
      resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / (24 * HOUR)));
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('TLS timeout'));
    });
    socket.on('error', reject);
  });
}

/** Local date + hour in the configured timezone, e.g. {date:'2026-11-15', hour:9}. */
function localParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms))
    .reduce((o, p) => ((o[p.type] = p.value), o), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * Watchdog agent: checks the site, the secrets, the database rules and stuck orders, and alerts a human.
 * It only reads and reports. It cannot change anything.
 */
export function createWatchdog({ cfg, db, discord, fetchImpl: rawFetch = fetch, tlsImpl = tlsDaysLeft, now = () => Date.now() }) {
  // Never let a slow server hang the watchdog.
  const fetchImpl = (url, init = {}) => rawFetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const state = new Map(); // key -> { severity, lastAlert }
  const REALERT_MS = 6 * HOUR;
  let lastRun = 0;
  let lastDigestDate = '';

  const ICON = { critical: '🚨', warn: '⚠️', ok: '✅' };

  /** Alert only when something changes (or every 6h while it stays broken), and say when it recovers. */
  async function report(key, severity, text, room = 'security-alerts') {
    const prev = state.get(key);
    const t = now();
    if (severity === 'ok') {
      if (prev && prev.severity !== 'ok') {
        state.set(key, { severity: 'ok', lastAlert: t });
        await discord.postTo(room, `${ICON.ok} Recovered: ${text}`).catch(() => {});
      }
      return;
    }
    const changed = !prev || prev.severity !== severity;
    if (changed || t - prev.lastAlert >= REALERT_MS) {
      state.set(key, { severity, lastAlert: t });
      await discord.postTo(room, `${ICON[severity]} ${severity.toUpperCase()}: ${text}`).catch((e) => console.error('[watchdog post]', e?.message));
    }
  }

  async function checkSite() {
    const base = cfg.siteUrl.replace(/\/$/, '');
    let html = '';
    let homeHeaders = null;
    try {
      const res = await fetchImpl(base + '/', { redirect: 'follow' });
      homeHeaders = res.headers;
      if (res.status !== 200) {
        await report('site:down', 'critical', `Site returned HTTP ${res.status} (${base}).`);
        return;
      }
      html = await res.text();
      await report('site:down', 'ok', `Site is back up (${base}).`);
    } catch (err) {
      await report('site:down', 'critical', `Site unreachable (${base}): ${err?.message || err}`);
      return;
    }

    // Required pages
    for (const p of cfg.legalPaths || ['privacy', 'terms']) {
      try {
        const r = await fetchImpl(`${base}/${p}`);
        await report(`page:${p}`, r.status === 200 ? 'ok' : 'warn', `${p} returned HTTP ${r.status}.`);
      } catch (err) {
        await report(`page:${p}`, 'warn', `${p} unreachable: ${err?.message || err}`);
      }
    }

    // Content-Security-Policy: a real response header (Vercel) or a meta tag both count
    const hasCsp = Boolean(homeHeaders?.get?.('content-security-policy')) || /http-equiv=["']Content-Security-Policy["']/i.test(html);
    await report('csp', hasCsp ? 'ok' : 'warn', 'No Content-Security-Policy on the home page. Add one in vercel.json headers.');

    // Leak scan: the page and the same-origin scripts it loads
    let corpus = html;
    for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
      try {
        const url = new URL(m[1], base + '/');
        if (url.origin !== new URL(base).origin) continue;
        const r = await fetchImpl(url.toString());
        if (r.status === 200) corpus += '\n' + (await r.text());
      } catch {
        /* skip unreadable script */
      }
    }
    const leaks = scanLeaks(corpus);
    await report('leak', leaks.length ? 'critical' : 'ok', `Possible secret exposed on the public site: ${leaks.join(', ')}. Rotate it NOW, then remove it from the page.`);

    // Kaapo's AI endpoints (Vercel functions). GET /api/ai says whether the Gemini key is configured;
    // /api/transcribe only accepts POST, so 405 on GET means "deployed and alive".
    if (cfg.kaapoCheck !== false) {
      try {
        const r = await fetchImpl(`${base}/api/ai`);
        const body = r.status === 200 ? await r.json().catch(() => null) : null;
        await report('kaapo:ai', r.status === 200 && body?.ok === true ? 'ok' : 'critical',
          r.status === 200 ? 'Kaapo AI is up but GEMINI_API_KEY is missing in Vercel.' : `Kaapo AI endpoint /api/ai returned HTTP ${r.status}.`);
      } catch (err) {
        await report('kaapo:ai', 'critical', `Kaapo AI endpoint unreachable: ${err?.message || err}`);
      }
      try {
        const r = await fetchImpl(`${base}/api/transcribe`);
        await report('kaapo:transcribe', r.status === 405 || r.status === 200 ? 'ok' : 'critical', `Kaapo transcribe endpoint returned HTTP ${r.status} (expected 405).`);
      } catch (err) {
        await report('kaapo:transcribe', 'critical', `Kaapo transcribe endpoint unreachable: ${err?.message || err}`);
      }
    }

    // TLS expiry
    try {
      const u = new URL(base);
      if (u.protocol === 'https:') {
        const days = await tlsImpl(u.hostname);
        const sev = days < 5 ? 'critical' : days < 14 ? 'warn' : 'ok';
        await report('tls', sev, `TLS certificate for ${u.hostname} expires in ${days} day(s).`);
      }
    } catch (err) {
      await report('tls', 'warn', `Could not check the TLS certificate: ${err?.message || err}`);
    }
  }

  async function checkRls() {
    if (!cfg.supabasePublishableKey) return;
    const { leaking, errors } = await probeRls({ fetchImpl, supabaseUrl: cfg.supabaseUrl, key: cfg.supabasePublishableKey });
    await report(
      'rls',
      leaking.length ? 'critical' : 'ok',
      `Anyone with the website's public key can READ rows from: ${leaking.join(', ')}. Row-level security is wrong; fix it in Supabase now.`
    );
    await report('rls:probe', errors.length ? 'warn' : 'ok', `RLS probe could not complete: ${errors.join('; ')}`);
  }

  async function checkOrders() {
    const t = now();
    const rules = [
      ['triaging', 10 * MIN, 'stuck in triage'],
      ['awaiting_approval', 24 * HOUR, 'waiting for approval over 24h'],
      ['in_progress', 72 * HOUR, 'in progress over 72h'],
    ];
    const active = new Set();
    for (const [status, age, label] of rules) {
      const orders = await db.ordersByStatus([status], new Date(t - age).toISOString());
      for (const o of orders) {
        const key = `stuck:${o.id}:${status}`;
        active.add(key);
        await report(key, 'warn', `Order \`${String(o.id).slice(0, 8)}\` (${o.name}, ${o.channel}) ${label}.`, 'agent-logs');
      }
    }
    for (const o of await db.deliveredButUnpaid()) {
      const key = `unpaid:${o.id}`;
      active.add(key);
      await report(key, 'warn', `Order \`${String(o.id).slice(0, 8)}\` (${o.name}) is ${o.status} but payment is ${o.payment_status}. Copyright stays with us until final payment.`, 'agent-logs');
    }
    // Forget resolved ones silently
    for (const k of [...state.keys()]) if ((k.startsWith('stuck:') || k.startsWith('unpaid:')) && !active.has(k)) state.delete(k);
  }

  /** Run every check once. One failing check never stops the others. */
  async function runChecks() {
    const steps = [];
    if (cfg.siteUrl) steps.push(['site', checkSite]);
    steps.push(['rls', checkRls], ['orders', checkOrders]);
    for (const [name, fn] of steps) {
      try {
        await fn();
      } catch (err) {
        console.error(`[watchdog:${name}]`, err?.message || err);
        await report(`check-error:${name}`, 'warn', `Watchdog check "${name}" failed to run: ${err?.message || err}`, 'agent-logs');
      }
    }
  }

  async function sendDigest() {
    const counts = await db.statusCounts();
    const failed = await db.failedTaskCountSince(new Date(now() - 24 * HOUR).toISOString());
    const pendingPay = await db.pendingPaymentCount();
    const open = [...state.entries()].filter(([, v]) => v.severity !== 'ok').length;
    const lines = Object.entries(counts).map(([s, n]) => `• ${s}: ${n}`).join('\n') || '• no orders yet';
    await discord.postTo(
      'agent-logs',
      `📋 **Daily digest**\n${lines}\n\nFailed tasks (24h): ${failed}\nPayments waiting for a human: ${pendingPay}\nOpen alerts: ${open}`
    );
  }

  /** Call every few minutes. Runs checks every CHECK_MINUTES and the digest once a day. */
  async function tick() {
    const t = now();
    if (t - lastRun >= cfg.checkMinutes * MIN) {
      lastRun = t;
      await runChecks();
    }
    const { date, hour } = localParts(t, cfg.timezone);
    if (hour === cfg.digestHour && lastDigestDate !== date) {
      lastDigestDate = date;
      await sendDigest().catch((e) => console.error('[digest]', e?.message));
    }
  }

  return { runChecks, sendDigest, tick, _state: state };
}
