// Discord for the Ovrix service agents, serverless edition.
// Posting uses Discord's REST API with the bot token. Buttons and slash commands arrive as signed
// HTTPS "interactions" at /api/ops/discord, so no always-on bot connection is needed.
// Same message layout and button ids as the original discord.js version.
import crypto from 'node:crypto';

const API = 'https://discord.com/api/v10';

/** Every channel the agents post in. The bot creates any that are missing. */
export const REQUIRED_CHANNELS = ['approvals', 'agent-logs', 'video-editing', 'ai-films', 'ai-ads', 'website-build', 'custom-bots',
  'discord-bots', 'discord-servers', 'hosting', 'support', 'payments', 'security-alerts'];
const TOPICS = {
  approvals: 'New briefs with the Manager\'s plan. Approve or reject here.',
  'agent-logs': 'What the agents did, step by step.',
  support: 'Reply drafts for clients. Send with /reply.',
  payments: 'Verified payments. Confirm with the buttons or /mark-paid.',
  'security-alerts': 'Watchdog alerts and the daily digest.',
};
const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t || '—';
};
const chunk = (s, n = 1900) => {
  const out = [];
  const text = String(s ?? '');
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out.length ? out : ['(empty)'];
};
// AI output is derived from client text, so it must never be able to ping @everyone or roles.
const NO_PINGS = { parse: [] };
const EPHEMERAL = 64;

export const COMMANDS = [
  {
    name: 'reply', type: 1, description: 'Draft a reply to a client message (nothing is sent to the client)',
    options: [
      { type: 3, name: 'order', description: 'Which order', required: true, autocomplete: true },
      { type: 3, name: 'message', description: 'Paste the client message here', required: true, max_length: 1500 },
    ],
  },
  {
    name: 'mark-paid', type: 1, description: 'Set the payment status of an order by hand',
    options: [
      { type: 3, name: 'order', description: 'Which order', required: true, autocomplete: true },
      {
        type: 3, name: 'status', description: 'New payment status', required: true,
        choices: [
          { name: 'Deposit paid', value: 'deposit_paid' },
          { name: 'Fully paid', value: 'paid' },
          { name: 'Unpaid', value: 'unpaid' },
        ],
      },
    ],
  },
];

/** Verify Discord's Ed25519 signature on an interaction request. */
export function verifyInteraction(rawBody, signature, timestamp, publicKeyHex) {
  if (!publicKeyHex || !signature || !timestamp) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')]),
      format: 'der', type: 'spki',
    });
    return crypto.verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export function makeDiscord(cfg, fetchImpl = fetch) {
  const ready = Boolean(cfg.discordToken && cfg.guildId);
  async function api(path, method = 'GET', body, auth = true) {
    const r = await fetchImpl(API + path, {
      method,
      headers: { ...(auth ? { Authorization: `Bot ${cfg.discordToken}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Discord ${method} ${path.split('?')[0]} ${r.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  // Cached per warm function instance.
  let channels = null, guild = null, roles = null;
  async function room(name) {
    if (!ready) throw new Error('Discord is not configured (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID).');
    if (!channels) channels = await api(`/guilds/${cfg.guildId}/channels`);
    const ch = channels.find((c) => c.name === name && (c.type === 0 || c.type === 5));
    if (!ch) throw new Error(`Discord channel #${name} not found. Create it (see ops/SETUP.md).`);
    return ch.id;
  }
  const send = async (name, payload) => api(`/channels/${await room(name)}/messages`, 'POST', { allowed_mentions: NO_PINGS, ...payload });

  /** Owner, anyone with the approver role (by name), or a user id listed in DISCORD_APPROVER_IDS. */
  async function isApprover(interaction) {
    const userId = interaction.member?.user?.id || interaction.user?.id;
    if (!userId || interaction.guild_id !== cfg.guildId) return false;
    if ((cfg.approverIds || []).includes(userId)) return true;
    if (!guild) guild = await api(`/guilds/${cfg.guildId}`);
    if (guild.owner_id === userId) return true;
    if (!roles) roles = await api(`/guilds/${cfg.guildId}/roles`);
    const names = new Set((interaction.member?.roles || []).map((id) => roles.find((r) => r.id === id)?.name));
    return names.has(cfg.approverRole || 'Approver');
  }

  const button = (custom_id, label, style) => ({ type: 2, custom_id, label, style }); // 1 primary 2 secondary 3 success 4 danger

  return {
    ready,
    api,
    isApprover,

    /** Post the manager's plan with Approve / Reject buttons. Returns the Discord message id. */
    async postApproval({ order, plan }) {
      const embed = {
        title: `New brief · ${clip(order.channel, 60)}`,
        description: clip(plan.summary, 1000),
        color: plan.priority === 'high' ? 0xef4444 : plan.priority === 'low' ? 0x6b7280 : 0x6366f1,
        fields: [
          { name: 'Client', value: clip(`${order.name} · ${order.email}`, 200), inline: true },
          { name: 'Budget', value: clip(order.budget, 100), inline: true },
          { name: 'When', value: clip(order.timeline, 100), inline: true },
          { name: 'Found us via', value: clip(order.source, 100), inline: true },
          { name: 'Priority', value: clip(plan.priority, 20), inline: true },
          { name: 'Routed to', value: clip(plan.agent, 40), inline: true },
          { name: 'Suggested quote', value: clip(plan.quote, 100), inline: true },
          { name: 'Order id', value: `\`${order.id}\``, inline: false },
          { name: 'Questions to ask the client', value: clip(plan.questions.map((q) => `• ${q}`).join('\n'), 1000) },
          { name: 'Proposed tasks', value: clip(plan.tasks.map((t) => `• **${t.agent}**: ${t.title}`).join('\n'), 1000) },
          { name: 'Client brief', value: clip(order.message, 1000) },
        ],
        footer: { text: 'Approve starts specialist planning. Nothing is sent to the client.' },
      };
      const components = [{ type: 1, components: [
        button(`decision:approved:${order.id}`, 'Approve', 3),
        button(`decision:rejected:${order.id}`, 'Reject', 4),
      ] }];
      const msg = await send('approvals', { embeds: [embed], components });
      return msg.id;
    },

    /** Post a verified payment to #payments with Deposit / Fully paid / Ignore buttons. */
    async postPaymentPrompt({ payment, candidates }) {
      const money = `${payment.currency} ${Number(payment.amount).toFixed(2)}`;
      const lines = candidates.length
        ? candidates.map((o) => `• \`${String(o.id).slice(0, 8)}\` ${clip(o.name, 40)} · ${o.channel} · ${o.payment_status}`).join('\n')
        : 'No unpaid order matches this email. Use /mark-paid once you know which order it belongs to.';
      const embed = {
        title: `💳 ${payment.provider} payment received · ${money}`,
        color: 0x22c55e,
        fields: [
          { name: 'Payer email', value: clip(payment.email, 200), inline: true },
          { name: 'Reference', value: clip(payment.reference, 100), inline: true },
          { name: candidates.length === 1 ? 'Matched order' : 'Possible orders', value: clip(lines, 1000) },
        ],
        footer: { text: 'Verified by signature. Pick how much of the order this covers.' },
      };
      const row = candidates.length === 1
        ? [button(`pay:deposit:${payment.id}:${candidates[0].id}`, 'Deposit paid', 1),
           button(`pay:paid:${payment.id}:${candidates[0].id}`, 'Fully paid', 3),
           button(`pay:ignore:${payment.id}`, 'Ignore', 2)]
        : [button(`pay:ignore:${payment.id}`, 'Dismiss', 2)];
      const msg = await send('payments', { embeds: [embed], components: [{ type: 1, components: row }] });
      return msg.id;
    },

    /** Post text (split to fit Discord's 2000-char limit) into a named channel. */
    async postTo(name, text) {
      for (const part of chunk(text)) await send(name, { content: part });
    },
    postLog(text) {
      return this.postTo('agent-logs', text);
    },

    /** Edit the original interaction response (used after a deferred reply). */
    editOriginal(appId, token, body) {
      return api(`/webhooks/${appId}/${token}/messages/@original`, 'PATCH', { allowed_mentions: NO_PINGS, ...body }, false);
    },

    /** Register the slash commands for this server only (instant, invisible elsewhere). */
    async registerCommands() {
      const app = await api('/applications/@me');
      await api(`/applications/${app.id}/guilds/${cfg.guildId}/commands`, 'PUT', COMMANDS);
      return app.id;
    },

    /**
     * One-time server setup, safe to repeat: registers the slash commands, creates the Approver role
     * and gives it to the server owner, and creates any missing channels under an "Ovrix Agents" category.
     */
    async ensureSetup(names = REQUIRED_CHANNELS) {
      const g = cfg.guildId;
      const appId = await this.registerCommands();
      const roleName = cfg.approverRole || 'Approver';
      roles = await api(`/guilds/${g}/roles`);
      let role = roles.find((r) => r.name === roleName);
      const roleCreated = !role;
      if (!role) role = await api(`/guilds/${g}/roles`, 'POST', { name: roleName, permissions: '0', hoist: false, mentionable: false });
      guild = await api(`/guilds/${g}`);
      let ownerHasRole = true;
      try { await api(`/guilds/${g}/members/${guild.owner_id}/roles/${role.id}`, 'PUT'); } catch { ownerHasRole = false; }
      channels = await api(`/guilds/${g}/channels`);
      const text = (n) => channels.find((c) => c.name === n && (c.type === 0 || c.type === 5));
      const created = [];
      const missing = names.filter((n) => !text(n));
      if (missing.length) {
        let cat = channels.find((c) => c.type === 4 && c.name.toLowerCase() === 'ovrix agents');
        if (!cat) cat = await api(`/guilds/${g}/channels`, 'POST', { name: 'Ovrix Agents', type: 4 });
        for (const n of missing) {
          await api(`/guilds/${g}/channels`, 'POST', { name: n, type: 0, parent_id: cat.id, ...(TOPICS[n] ? { topic: TOPICS[n] } : {}) });
          created.push(n);
        }
      }
      channels = null; roles = null;
      return { appId, created, roleCreated, ownerHasRole };
    },

    /** Which of the required channels exist (for the setup check). */
    async missingChannels(names) {
      channels = null;
      const out = [];
      for (const n of names) { try { await room(n); } catch { out.push(n); } }
      return out;
    },
  };
}

/**
 * Turn one Discord interaction into the HTTP response Discord expects, and schedule the slow part
 * (AI work, database writes) with waitUntil so it keeps running after we answer within 3 seconds.
 */
export async function handleInteraction(i, { discord, handlers, waitUntil, log = console }) {
  if (i.type === 1) return { type: 1 }; // PING
  const denied = { type: 4, data: { content: 'Only the "Approver" role can do this.', flags: EPHEMERAL } };
  const appId = i.application_id;
  const userId = i.member?.user?.id || i.user?.id;
  const later = (fn) => waitUntil(Promise.resolve().then(fn).catch((e) => log.error?.('[interaction]', e?.message || e)));
  const opt = (name) => (i.data?.options || []).find((o) => o.name === name)?.value;

  // Buttons
  if (i.type === 3) {
    const id = String(i.data?.custom_id || '');
    if (!(await discord.isApprover(i))) return denied;
    if (id.startsWith('decision:')) {
      const [, decision, orderId] = id.split(':');
      later(async () => {
        const res = await handlers.decision({ orderId, decision, userId });
        const note = !res.ok ? 'Already handled.'
          : decision === 'approved' ? `✅ Approved by <@${userId}>. Specialists are drafting plans.` : `❌ Rejected by <@${userId}>.`;
        await discord.editOriginal(appId, i.token, { content: note, components: [] });
        if (res.work) await res.work;
      });
      return { type: 6 }; // deferred update: keep the message, edit it shortly
    }
    if (id.startsWith('pay:')) {
      const [, action, paymentId, orderId] = id.split(':');
      later(async () => {
        const res = await handlers.pay({ paymentId, orderId, action, userId });
        const note = !res.ok ? 'Already handled.'
          : action === 'ignore' ? `🚫 Ignored by <@${userId}>.`
          : `💰 Marked **${action === 'paid' ? 'fully paid' : 'deposit paid'}** by <@${userId}>.`;
        await discord.editOriginal(appId, i.token, { content: note, components: [] });
      });
      return { type: 6 };
    }
    return { type: 4, data: { content: 'Unknown button.', flags: EPHEMERAL } };
  }

  // Autocomplete for the "order" option
  if (i.type === 4) {
    if (!(await discord.isApprover(i))) return { type: 8, data: { choices: [] } };
    const focused = (i.data?.options || []).find((o) => o.focused);
    const typed = String(focused?.value || '').toLowerCase();
    const orders = await handlers.listOrders();
    const choices = orders
      .map((o) => ({
        name: clip(`${String(o.id).slice(0, 8)} · ${o.name} · ${o.channel} · ${o.status}`, 100),
        value: String(o.id),
        hay: `${o.id} ${o.name} ${o.email} ${o.channel}`.toLowerCase(),
      }))
      .filter((c) => !typed || c.hay.includes(typed))
      .slice(0, 25)
      .map(({ name, value }) => ({ name, value }));
    return { type: 8, data: { choices } };
  }

  // Slash commands
  if (i.type === 2) {
    if (!(await discord.isApprover(i))) return denied;
    const name = i.data?.name;
    if (name === 'reply') {
      later(async () => {
        const res = await handlers.reply({ orderId: opt('order'), clientMessage: opt('message'), userId });
        await discord.editOriginal(appId, i.token, { content: res.ok ? 'Draft posted in #support. Nothing was sent to the client.' : `Could not draft: ${res.reason}` });
      });
      return { type: 5, data: { flags: EPHEMERAL } };
    }
    if (name === 'mark-paid') {
      later(async () => {
        const res = await handlers.markPaid({ orderId: opt('order'), status: opt('status'), userId });
        await discord.editOriginal(appId, i.token, { content: res.ok ? `Payment status set to **${res.status}**.` : `Could not update: ${res.reason}` });
      });
      return { type: 5, data: { flags: EPHEMERAL } };
    }
    return { type: 4, data: { content: 'Unknown command.', flags: EPHEMERAL } };
  }
  return { type: 4, data: { content: 'Unsupported interaction.', flags: EPHEMERAL } };
}
