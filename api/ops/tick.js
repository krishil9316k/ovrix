// POST /api/ops/tick  (called by the database when a new brief arrives, and every few minutes as a catch-up)
// Manager agent: claims new leads, triages them with AI and posts each plan to Discord #approvals.
import { buildAgents, authorised } from '../../ops/runtime.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!authorised(req.headers['x-ops-secret'] || req.headers.authorization)) return res.status(401).json({ error: 'unauthorised' });
  try {
    const { manager, discord } = buildAgents();
    // Leave briefs untouched until Discord is connected, so none are marked failed during setup.
    if (!discord.ready) return res.status(200).json({ ok: true, skipped: 'discord not configured yet' });
    await manager.processNewOrders();
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
