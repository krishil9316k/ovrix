// POST /api/ops/watchdog          every 30 min from the database scheduler: site, secrets, RLS, Kaapo, stuck orders
// POST /api/ops/watchdog?digest=1 once a day at 9 AM IST: daily digest in #agent-logs
// Alert memory is kept in the ops_state table, so alerts fire only when something changes.
import { buildAgents, authorised, safeError } from '../../ops/runtime.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!authorised(req.headers['x-ops-secret'] || req.headers.authorization)) return res.status(401).json({ error: 'unauthorised' });
  try {
    const { watchdog, db } = buildAgents();
    const saved = await db.getState('watchdog').catch(() => null);
    for (const [k, v] of Object.entries(saved || {})) watchdog._state.set(k, v);
    if (String(req.query?.digest || '') === '1') await watchdog.sendDigest();
    else await watchdog.runChecks();
    await db.setState('watchdog', Object.fromEntries(watchdog._state));
    res.status(200).json({ ok: true, open: [...watchdog._state.values()].filter((v) => v.severity !== 'ok').length });
  } catch (e) {
    res.status(e.status || 500).json({ error: safeError(e) });
  }
}
