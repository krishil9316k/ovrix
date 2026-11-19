const short = (id) => String(id).slice(0, 8);
const money = (e) => `${e.currency} ${Number(e.amount).toFixed(2)}`;

/**
 * Billing agent. It never moves money and never emails anyone. It only:
 *  1. stores each signature-verified payment event once (idempotent),
 *  2. tries to match it to an unpaid order by the payer's email,
 *  3. asks a human in #payments to confirm "Deposit paid / Fully paid / Ignore".
 * Refunds are only announced; a human handles them in Stripe/Razorpay.
 */
export function createBilling({ db, discord }) {
  async function handleEvent(evt) {
    const payment = await db.insertPayment(evt);
    if (!payment) return { duplicate: true }; // provider retried; already stored

    await db.log({
      agent: 'billing',
      event: evt.kind === 'refund' ? 'refund_received' : 'payment_received',
      detail: { provider: evt.provider, amount: evt.amount, currency: evt.currency, reference: evt.reference },
    });

    // The event is safely stored at this point. A Discord hiccup must not make the provider retry
    // (a retry would just be seen as a duplicate and the prompt would never be posted), so we log it instead.
    try {
      if (evt.kind === 'refund') {
        await discord.postTo(
          'payments',
          `↩️ **Refund** on ${evt.provider}: ${money(evt)} (ref \`${evt.reference}\`). Check the order and update its status by hand if needed.`
        );
        await db.claimPayment(payment.id, 'confirmed');
        return { stored: true, refund: true };
      }
      const candidates = evt.email ? await db.findUnpaidOrdersByEmail(evt.email) : [];
      await discord.postPaymentPrompt({ payment, candidates });
      return { stored: true, candidates: candidates.length };
    } catch (err) {
      await db.log({ agent: 'billing', event: 'error', detail: { message: String(err?.message || err), payment: payment.id } });
      console.error('[billing] stored payment but could not post to Discord:', err?.message);
      return { stored: true, notified: false };
    }
  }

  /** Button press in #payments. Only the first press counts. */
  async function handlePayDecision({ paymentId, orderId, action, userId }) {
    if (action === 'ignore') {
      const row = await db.claimPayment(paymentId, 'ignored');
      if (!row) return { ok: false, reason: 'already_handled' };
      await db.log({ agent: 'billing', event: 'payment_ignored', detail: { payment: paymentId, by: userId } });
      return { ok: true };
    }
    if (action !== 'deposit' && action !== 'paid') return { ok: false, reason: 'bad_action' };
    if (!orderId) return { ok: false, reason: 'no_order' };

    const row = await db.claimPayment(paymentId, 'confirmed');
    if (!row) return { ok: false, reason: 'already_handled' };
    const status = action === 'paid' ? 'paid' : 'deposit_paid';
    await db.markOrderPayment(orderId, status);
    await db.log({ agent: 'billing', order_id: orderId, event: 'payment_confirmed', detail: { status, payment: paymentId, by: userId } });
    await discord.postLog(`💰 Order \`${short(orderId)}\` marked **${status}** by a human.`).catch(() => {});
    return { ok: true, status };
  }

  /** /mark-paid command: set the status by hand (cash, bank transfer, corrections). */
  async function markPaid({ orderId, status, userId }) {
    if (!['unpaid', 'deposit_paid', 'paid'].includes(status)) return { ok: false, reason: 'bad_status' };
    try {
      await db.getOrder(orderId);
    } catch {
      return { ok: false, reason: 'order_not_found' };
    }
    await db.markOrderPayment(orderId, status);
    await db.log({ agent: 'billing', order_id: orderId, event: 'manual_payment_status', detail: { status, by: userId } });
    await discord.postLog(`💰 Order \`${short(orderId)}\` set to **${status}** by a human (manual).`).catch(() => {});
    return { ok: true, status };
  }

  return { handleEvent, handlePayDecision, markPaid };
}
