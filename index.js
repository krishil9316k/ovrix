import { loadConfig } from './lib/config.js';
import { makeDb } from './lib/db.js';
import { makeClaude } from './lib/claude.js';
import { makeDiscord } from './lib/discord.js';
import { createWebhookServer } from './lib/webhooks.js';
import { createManager } from './agents/manager.js';
import { createBilling } from './agents/billing.js';
import { createSupport } from './agents/support.js';
import { createWatchdog } from './agents/watchdog.js';

const cfg = loadConfig();
const db = makeDb(cfg);
const claude = makeClaude(cfg);
const discord = await makeDiscord(cfg);
const support = createSupport({ db, claude, discord });
const billing = createBilling({ db, discord });
const manager = createManager({ cfg, db, claude, discord, support });
const watchdog = createWatchdog({ cfg, db, discord });

discord.setHandlers({
  decision: manager.handleDecision,
  pay: billing.handlePayDecision,
  markPaid: billing.markPaid,
  reply: support.draftReply,
  listOrders: () => db.listRecentOrders(25),
});

// Payment webhooks (only accept signed requests; both are disabled until their secret is set)
const server = createWebhookServer({ cfg, onEvent: billing.handleEvent });
server.listen(cfg.port, () => console.log(`Webhook server on :${cfg.port} (/webhooks/stripe, /webhooks/razorpay, /health)`));

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('SIGINT', async () => {
  console.log('Shutting down…');
  await discord.postLog('🔴 Agents going offline.').catch(() => {});
  server.close();
  discord.destroy();
  process.exit(0);
});

await manager.recover();
await discord.postLog('🟢 Agents online: manager, support, billing, watchdog.');
console.log(`Agents online. Polling every ${cfg.pollSeconds}s.`);

const tick = () => manager.processNewOrders().catch((e) => console.error('[tick]', e));
await tick();
setInterval(tick, cfg.pollSeconds * 1000);

const watch = () => watchdog.tick().catch((e) => console.error('[watchdog]', e));
await watch();
setInterval(watch, 5 * 60 * 1000);
