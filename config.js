import 'dotenv/config';

const need = (key) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing environment variable ${key}. Copy .env.example to .env and fill it in.`);
  return v;
};
const opt = (key, fallback = '') => process.env[key] || fallback;

export function loadConfig() {
  return {
    // required
    anthropicKey: need('ANTHROPIC_API_KEY'),
    supabaseUrl: need('SUPABASE_URL'),
    supabaseServiceKey: need('SUPABASE_SERVICE_KEY'),
    discordToken: need('DISCORD_BOT_TOKEN'),
    guildId: need('DISCORD_GUILD_ID'),

    // core tuning
    model: opt('CLAUDE_MODEL', 'claude-sonnet-5-5'),
    approverRole: opt('DISCORD_APPROVER_ROLE', 'Approver'),
    pollSeconds: Number(opt('POLL_SECONDS', '30')),
    maxOrdersPerCycle: Number(opt('MAX_ORDERS_PER_CYCLE', '3')),
    maxTokens: Number(opt('MAX_TOKENS', '1800')),
    leadsTable: opt('LEADS_TABLE', 'leads'),

    // billing agent (webhooks are off until a secret is set)
    port: Number(opt('PORT', '3000')),
    stripeWebhookSecret: opt('STRIPE_WEBHOOK_SECRET'),
    razorpayWebhookSecret: opt('RAZORPAY_WEBHOOK_SECRET'),

    // watchdog agent (site checks are off until SITE_URL is set)
    siteUrl: opt('SITE_URL'),
    supabasePublishableKey: opt('SUPABASE_PUBLISHABLE_KEY'),
    checkMinutes: Number(opt('CHECK_MINUTES', '30')),
    digestHour: Number(opt('DIGEST_HOUR', '9')),
    timezone: opt('TIMEZONE', 'Asia/Kolkata'),
  };
}
