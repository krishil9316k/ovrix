import http from 'node:http';
import crypto from 'node:crypto';

const safeEqual = (a, b) => {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

/** Stripe: header "t=<unix>,v1=<hmac>"; HMAC-SHA256 over `${t}.${rawBody}`. Rejects old timestamps (replay). */
export function verifyStripe(rawBuf, header, secret, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300) {
  if (!header || !secret) return false;
  let t;
  const sigs = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    if (k === 't') t = v;
    if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length || !Number.isFinite(Number(t))) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${t}.`), rawBuf]))
    .digest('hex');
  return sigs.some((s) => safeEqual(s, expected));
}

/** Razorpay: header X-Razorpay-Signature = hex HMAC-SHA256 of the raw body. */
export function verifyRazorpay(rawBuf, header, secret) {
  if (!header || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBuf).digest('hex');
  return safeEqual(header, expected);
}

/** Turn a Stripe event into our neutral shape, or null if it's an event we ignore. */
export function normalizeStripe(event) {
  const obj = event?.data?.object;
  if (!obj) return null;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (obj.payment_status !== 'paid') return null;
    return {
      provider: 'stripe',
      event_id: event.id,
      kind: 'payment',
      amount: (obj.amount_total ?? 0) / 100,
      currency: String(obj.currency || '').toUpperCase(),
      email: obj.customer_details?.email || obj.customer_email || null,
      reference: obj.id,
    };
  }
  if (event.type === 'charge.refunded') {
    return {
      provider: 'stripe',
      event_id: event.id,
      kind: 'refund',
      amount: (obj.amount_refunded ?? 0) / 100,
      currency: String(obj.currency || '').toUpperCase(),
      email: obj.billing_details?.email || obj.receipt_email || null,
      reference: obj.id,
    };
  }
  return null;
}

/** Turn a Razorpay event into our neutral shape, or null. */
export function normalizeRazorpay(event, eventIdHeader) {
  if (event?.event === 'payment.captured') {
    const p = event.payload?.payment?.entity;
    if (!p) return null;
    return {
      provider: 'razorpay',
      event_id: eventIdHeader || `rzp_${p.id}`,
      kind: 'payment',
      amount: (p.amount ?? 0) / 100,
      currency: String(p.currency || '').toUpperCase(),
      email: p.email || null,
      reference: p.id,
    };
  }
  if (event?.event === 'refund.processed') {
    const r = event.payload?.refund?.entity;
    if (!r) return null;
    return {
      provider: 'razorpay',
      event_id: eventIdHeader || `rzp_${r.id}`,
      kind: 'refund',
      amount: (r.amount ?? 0) / 100,
      currency: String(r.currency || '').toUpperCase(),
      email: null,
      reference: r.payment_id || r.id,
    };
  }
  return null;
}

/**
 * Small HTTP server for payment webhooks. It only accepts requests whose signature verifies.
 * It replies 200 only after the event is stored, so providers retry on failure (events are idempotent).
 */
export function createWebhookServer({ cfg, onEvent, log = console }) {
  return http.createServer(async (req, res) => {
    const send = (code, msg) => {
      res.writeHead(code, { 'content-type': 'text/plain' });
      res.end(msg);
    };
    try {
      const route = (req.url || '').split('?')[0];
      if (req.method === 'GET' && route === '/health') return send(200, 'ok');
      if (req.method !== 'POST') return send(405, 'method not allowed');
      if (route !== '/webhooks/stripe' && route !== '/webhooks/razorpay') return send(404, 'not found');

      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 1_000_000) return send(413, 'payload too large');
        chunks.push(c);
      }
      const raw = Buffer.concat(chunks);

      let evt;
      if (route === '/webhooks/stripe') {
        if (!cfg.stripeWebhookSecret) return send(503, 'stripe webhook not configured');
        if (!verifyStripe(raw, req.headers['stripe-signature'], cfg.stripeWebhookSecret)) return send(400, 'bad signature');
        evt = normalizeStripe(JSON.parse(raw.toString('utf8')));
      } else {
        if (!cfg.razorpayWebhookSecret) return send(503, 'razorpay webhook not configured');
        if (!verifyRazorpay(raw, req.headers['x-razorpay-signature'], cfg.razorpayWebhookSecret)) return send(400, 'bad signature');
        evt = normalizeRazorpay(JSON.parse(raw.toString('utf8')), req.headers['x-razorpay-event-id']);
      }

      if (evt) await onEvent(evt);
      return send(200, 'ok');
    } catch (err) {
      log.error('[webhook]', err);
      return send(err instanceof SyntaxError ? 400 : 500, 'error');
    }
  });
}
