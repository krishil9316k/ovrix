// Builds the Ovrix service agents for one serverless request. Secrets come from Vercel env vars only.
import crypto from 'node:crypto';
import { makeDb } from './lib/db.js';
import { makeClaude } from './lib/claude.js';
import { makeDiscord } from './lib/discord.js';
import { createManager } from './agents/manager.js';
import { createBilling } from './agents/billing.js';
import { createSupport } from './agents/support.js';
import { createWatchdog } from './agents/watchdog.js';

const opt = (k, d = '') => process.env[k] || d;
// Secrets never contain spaces or line breaks, so strip any that sneak in when a key is copied and pasted.
const secret = (k) => String(process.env[k] || '').replace(/\s+/g, '');

/** Error text that is safe to return or log: anything that looks like a key or token is masked. */
export function safeError(e) {
  return String(e?.message || e || 'error')
    .replace(/sb_(secret|publishable)_[\w-]+(\s+[\w-]+)?/g, 'sb_$1_[hidden]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt hidden]')
    .replace(/[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}/g, '[token hidden]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[hidden]')
    .slice(0, 300);
}

export function loadConfig() {
  return {
    supabaseUrl: opt('SUPABASE_URL', 'https://yskrynljncjlonuzasux.supabase.co'),
    supabaseServiceKey: secret('SUPABASE_SERVICE_KEY'),
    supabasePublishableKey: opt('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_nLhyJLvGOmyHnruPUhk_Iw_sSzJqRdB'),
    leadsTable: opt('LEADS_TABLE', 'leads'),
    discordToken: secret('DISCORD_BOT_TOKEN'),
    guildId: secret('DISCORD_GUILD_ID'),
    discordPublicKey: secret('DISCORD_PUBLIC_KEY'),
    approverRole: opt('DISCORD_APPROVER_ROLE', 'Approver'),
    approverIds: opt('DISCORD_APPROVER_IDS').split(',').map((s) => s.trim()).filter(Boolean),
    maxOrdersPerCycle: Number(opt('MAX_ORDERS_PER_CYCLE', '3')),
    maxTokens: Number(opt('MAX_TOKENS', '1800')),
    stripeWebhookSecret: secret('STRIPE_WEBHOOK_SECRET'),
    razorpayWebhookSecret: secret('RAZORPAY_WEBHOOK_SECRET'),
    siteUrl: opt('SITE_URL', 'https://www.ovrix.in'),
    // Hosting clients' sites for the Watchdog, comma-separated: https://a.com,https://b.in
    clientSites: opt('CLIENT_SITES').split(',').map((s) => s.trim()).filter(Boolean),
    legalPaths: ['privacy', 'terms'],
    checkMinutes: 0,
    digestHour: 9,
    timezone: 'Asia/Kolkata',
    opsSecret: secret('OPS_SECRET'),
  };
}

export function buildAgents(cfg = loadConfig()) {
  if (!cfg.supabaseServiceKey) throw Object.assign(new Error('SUPABASE_SERVICE_KEY is not set in Vercel'), { status: 503 });
  const db = makeDb(cfg);
  const claude = makeClaude(cfg);
  const discord = makeDiscord(cfg);
  const support = createSupport({ db, claude, discord });
  const billing = createBilling({ db, discord });
  const manager = createManager({ cfg, db, claude, discord, support });
  const watchdog = createWatchdog({ cfg, db, discord });
  const handlers = {
    decision: manager.handleDecision,
    pay: billing.handlePayDecision,
    markPaid: billing.markPaid,
    reply: support.draftReply,
    listOrders: () => db.listRecentOrders(25),
  };
  return { cfg, db, claude, discord, support, billing, manager, watchdog, handlers };
}

/** The database (pg_net / pg_cron) calls our functions with this shared secret. */
export function authorised(headerValue, cfg = loadConfig()) {
  const want = cfg.opsSecret;
  const got = String(headerValue || '').replace(/^Bearer\s+/i, '');
  if (!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
