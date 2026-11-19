import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

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

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Draft a reply to a client message (nothing is sent to the client)')
    .addStringOption((o) => o.setName('order').setDescription('Which order').setRequired(true).setAutocomplete(true))
    .addStringOption((o) =>
      o.setName('message').setDescription('Paste the client message here').setRequired(true).setMaxLength(1500)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('mark-paid')
    .setDescription('Set the payment status of an order by hand')
    .addStringOption((o) => o.setName('order').setDescription('Which order').setRequired(true).setAutocomplete(true))
    .addStringOption((o) =>
      o
        .setName('status')
        .setDescription('New payment status')
        .setRequired(true)
        .addChoices(
          { name: 'Deposit paid', value: 'deposit_paid' },
          { name: 'Fully paid', value: 'paid' },
          { name: 'Unpaid', value: 'unpaid' }
        )
    )
    .toJSON(),
];

export async function makeDiscord(cfg) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const noHandler = async () => ({ ok: false, reason: 'no_handler' });
  let handlers = { decision: noHandler, pay: noHandler, reply: noHandler, markPaid: noHandler, listOrders: async () => [] };

  await client.login(cfg.discordToken);
  const guild = await client.guilds.fetch(cfg.guildId);
  await guild.channels.fetch();
  // Slash commands are registered for this server only (instant, and invisible elsewhere).
  await guild.commands.set(COMMANDS);

  const room = (name) => {
    const ch = guild.channels.cache.find((c) => c.name === name && c.isTextBased());
    if (!ch) throw new Error(`Discord channel #${name} not found. Create it (see discord/SERVER_SETUP.md).`);
    return ch;
  };

  const isApprover = (i) =>
    i.user.id === guild.ownerId || Boolean(i.member?.roles?.cache?.some((r) => r.name === cfg.approverRole));
  const denied = (i) =>
    i.reply({ content: `Only the "${cfg.approverRole}" role can do this.`, flags: MessageFlags.Ephemeral });

  async function onButton(i) {
    if (i.customId.startsWith('decision:')) {
      const [, decision, orderId] = i.customId.split(':');
      if (!isApprover(i)) return denied(i);
      await i.deferUpdate();
      const res = await handlers.decision({ orderId, decision, userId: i.user.id });
      const note = !res.ok
        ? 'Already handled.'
        : decision === 'approved'
          ? `✅ Approved by <@${i.user.id}>. Specialists are drafting plans.`
          : `❌ Rejected by <@${i.user.id}>.`;
      return i.editReply({ content: note, components: [], allowedMentions: NO_PINGS });
    }

    if (i.customId.startsWith('pay:')) {
      // pay:<deposit|paid|ignore>:<paymentId>[:<orderId>]
      const [, action, paymentId, orderId] = i.customId.split(':');
      if (!isApprover(i)) return denied(i);
      await i.deferUpdate();
      const res = await handlers.pay({ paymentId, orderId, action, userId: i.user.id });
      const note = !res.ok
        ? 'Already handled.'
        : action === 'ignore'
          ? `🚫 Ignored by <@${i.user.id}>.`
          : `💰 Marked **${action === 'paid' ? 'fully paid' : 'deposit paid'}** by <@${i.user.id}>.`;
      return i.editReply({ content: note, components: [], allowedMentions: NO_PINGS });
    }
  }

  async function onAutocomplete(i) {
    if (!isApprover(i)) return i.respond([]);
    const typed = String(i.options.getFocused() || '').toLowerCase();
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
    return i.respond(choices);
  }

  async function onCommand(i) {
    if (!isApprover(i)) return denied(i);
    if (i.commandName === 'reply') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await handlers.reply({
        orderId: i.options.getString('order', true),
        clientMessage: i.options.getString('message', true),
        userId: i.user.id,
      });
      return i.editReply({ content: res.ok ? 'Draft posted in #support. Nothing was sent to the client.' : `Could not draft: ${res.reason}` });
    }
    if (i.commandName === 'mark-paid') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await handlers.markPaid({
        orderId: i.options.getString('order', true),
        status: i.options.getString('status', true),
        userId: i.user.id,
      });
      return i.editReply({ content: res.ok ? `Payment status set to **${res.status}**.` : `Could not update: ${res.reason}` });
    }
  }

  client.on('interactionCreate', async (i) => {
    try {
      if (i.isButton()) return await onButton(i);
      if (i.isAutocomplete()) return await onAutocomplete(i);
      if (i.isChatInputCommand()) return await onCommand(i);
    } catch (err) {
      console.error('[interaction]', err);
      try {
        if (i.isRepliable?.() && !i.replied && !i.deferred) await i.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
      } catch {
        /* interaction already expired */
      }
    }
  });

  return {
    /** Register what the buttons and slash commands should call. Missing keys keep a safe no-op. */
    setHandlers(h) {
      handlers = { ...handlers, ...h };
    },
    /** Backwards-compatible helper used by the first version. */
    setDecisionHandler(fn) {
      handlers.decision = fn;
    },

    /** Post the manager's plan with Approve / Reject buttons. Returns the Discord message id. */
    async postApproval({ order, plan }) {
      const embed = new EmbedBuilder()
        .setTitle(`New brief · ${clip(order.channel, 60)}`)
        .setDescription(clip(plan.summary, 1000))
        .setColor(plan.priority === 'high' ? 0xef4444 : plan.priority === 'low' ? 0x6b7280 : 0x6366f1)
        .addFields(
          { name: 'Client', value: clip(`${order.name} · ${order.email}`, 200), inline: true },
          { name: 'Budget', value: clip(order.budget, 100), inline: true },
          { name: 'When', value: clip(order.timeline, 100), inline: true },
          { name: 'Found us via', value: clip(order.source, 100), inline: true },
          { name: 'Priority', value: plan.priority, inline: true },
          { name: 'Routed to', value: plan.agent, inline: true },
          { name: 'Suggested quote', value: clip(plan.quote, 100), inline: true },
          { name: 'Order id', value: `\`${order.id}\``, inline: false },
          { name: 'Questions to ask the client', value: clip(plan.questions.map((q) => `• ${q}`).join('\n'), 1000) },
          { name: 'Proposed tasks', value: clip(plan.tasks.map((t) => `• **${t.agent}**: ${t.title}`).join('\n'), 1000) },
          { name: 'Client brief', value: clip(order.message, 1000) }
        )
        .setFooter({ text: 'Approve starts specialist planning. Nothing is sent to the client.' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`decision:approved:${order.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`decision:rejected:${order.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
      );
      const msg = await room('approvals').send({ embeds: [embed], components: [row], allowedMentions: NO_PINGS });
      return msg.id;
    },

    /**
     * Post a verified payment to #payments. If it matched exactly one unpaid order the buttons are
     * "Deposit paid / Fully paid / Ignore"; with several candidates the person uses /mark-paid instead.
     */
    async postPaymentPrompt({ payment, candidates }) {
      const money = `${payment.currency} ${Number(payment.amount).toFixed(2)}`;
      const lines = candidates.length
        ? candidates.map((o) => `• \`${String(o.id).slice(0, 8)}\` ${clip(o.name, 40)} · ${o.channel} · ${o.payment_status}`).join('\n')
        : 'No unpaid order matches this email. Use /mark-paid once you know which order it belongs to.';
      const embed = new EmbedBuilder()
        .setTitle(`💳 ${payment.provider} payment received · ${money}`)
        .setColor(0x22c55e)
        .addFields(
          { name: 'Payer email', value: clip(payment.email, 200), inline: true },
          { name: 'Reference', value: clip(payment.reference, 100), inline: true },
          { name: candidates.length === 1 ? 'Matched order' : 'Possible orders', value: clip(lines, 1000) }
        )
        .setFooter({ text: 'Verified by signature. Pick how much of the order this covers.' });

      const components = [];
      if (candidates.length === 1) {
        const o = candidates[0].id;
        components.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`pay:deposit:${payment.id}:${o}`).setLabel('Deposit paid').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`pay:paid:${payment.id}:${o}`).setLabel('Fully paid').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`pay:ignore:${payment.id}`).setLabel('Ignore').setStyle(ButtonStyle.Secondary)
          )
        );
      } else {
        components.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`pay:ignore:${payment.id}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary)
          )
        );
      }
      const msg = await room('payments').send({ embeds: [embed], components, allowedMentions: NO_PINGS });
      return msg.id;
    },

    /** Post text (split to fit Discord's 2000-char limit) into a named channel. */
    async postTo(name, text) {
      const ch = room(name);
      for (const part of chunk(text)) await ch.send({ content: part, allowedMentions: NO_PINGS });
    },

    postLog(text) {
      return this.postTo('agent-logs', text);
    },

    destroy: () => client.destroy(),
  };
}
