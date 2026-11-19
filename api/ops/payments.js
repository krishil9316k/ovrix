// POST /api/ops/payments?provider=stripe|razorpay  (payment webhooks; off until their secrets are set)
// Billing agent: stores each verified payment once and asks a human in Discord #payments. Never marks paid by itself.
import { buildAgents, loadConfig } from '../../ops/runtime.js';
import { verifyStripe, verifyRazorpay, normalizeStripe, normalizeRazorpay } from '../../ops/lib/webhooks.js';

export async function POST(request) {
  const cfg = loadConfig();
  const provider = new URL(request.url).searchParams.get('provider');
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > 1_000_000) return new Response('payload too large', { status: 413 });
  let evt;
  if (provider === 'stripe') {
    if (!cfg.stripeWebhookSecret) return new Response('stripe webhook not configured', { status: 503 });
    if (!verifyStripe(raw, request.headers.get('stripe-signature'), cfg.stripeWebhookSecret)) return new Response('bad signature', { status: 400 });
    evt = normalizeStripe(JSON.parse(raw.toString('utf8')));
  } else if (provider === 'razorpay') {
    if (!cfg.razorpayWebhookSecret) return new Response('razorpay webhook not configured', { status: 503 });
    if (!verifyRazorpay(raw, request.headers.get('x-razorpay-signature'), cfg.razorpayWebhookSecret)) return new Response('bad signature', { status: 400 });
    evt = normalizeRazorpay(JSON.parse(raw.toString('utf8')), request.headers.get('x-razorpay-event-id'));
  } else return new Response('unknown provider', { status: 404 });
  if (!evt) return new Response('ignored', { status: 200 });
  const { billing } = buildAgents(cfg);
  await billing.handleEvent(evt);
  return new Response('ok', { status: 200 });
}
