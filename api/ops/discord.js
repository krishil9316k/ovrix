// POST /api/ops/discord  (Discord "Interactions Endpoint URL")
// Approve / Reject / payment buttons and the /reply and /mark-paid commands arrive here, signed by Discord.
import { waitUntil } from '@vercel/functions';
import { buildAgents, loadConfig } from '../../ops/runtime.js';
import { verifyInteraction, handleInteraction } from '../../ops/lib/discord.js';

export async function POST(request) {
  const cfg = loadConfig();
  const raw = await request.text();
  const ok = verifyInteraction(raw, request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'), cfg.discordPublicKey);
  if (!ok) return new Response('bad request signature', { status: 401 });
  const interaction = JSON.parse(raw);
  if (interaction.type === 1) return Response.json({ type: 1 }); // Discord's endpoint check
  const agents = buildAgents(cfg);
  const out = await handleInteraction(interaction, { ...agents, waitUntil });
  return Response.json(out);
}
