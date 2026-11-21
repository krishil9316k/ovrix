// GET  /api/ops/setup  public: shows which pieces are configured (true/false only, never values)
// POST /api/ops/setup  with the ops secret: runs the Discord setup again (commands, role, channels)
import { loadConfig, buildAgents, authorised, safeError } from '../../ops/runtime.js';

import { REQUIRED_CHANNELS as CHANNELS } from '../../ops/lib/discord.js';
export { CHANNELS };

export default async function handler(req, res) {
  const cfg = loadConfig();
  const status = {
    gemini: !!process.env.GEMINI_API_KEY, supabaseSecret: !!cfg.supabaseServiceKey, opsSecret: !!cfg.opsSecret,
    discordBot: !!cfg.discordToken, discordGuild: !!cfg.guildId, discordPublicKey: !!cfg.discordPublicKey,
    stripe: !!cfg.stripeWebhookSecret, razorpay: !!cfg.razorpayWebhookSecret,
  };
  if (req.method === 'GET') return res.status(200).json(status);
  if (req.method !== 'POST') return res.status(405).end();
  if (!authorised(req.headers['x-ops-secret'] || req.headers.authorization)) return res.status(401).json({ error: 'unauthorised' });
  try {
    const { discord } = buildAgents(cfg);
    const setup = await discord.ensureSetup(CHANNELS);
    const missing = await discord.missingChannels(CHANNELS);
    res.status(200).json({ ...status, commandsRegistered: true, ...setup, missingChannels: missing });
  } catch (e) {
    res.status(500).json({ ...status, error: safeError(e) });
  }
}
