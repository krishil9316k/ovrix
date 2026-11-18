import { gemini, fail } from './_gemini.js';

// GET  /api/ai        -> { ok } (is the AI key configured?)
// POST /api/ai        -> { text } from { prompt, images?: [base64 jpeg] }
export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: !!process.env.GEMINI_API_KEY });
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { prompt, images = [] } = req.body || {};
    if (typeof prompt !== 'string' || !prompt || prompt.length > 60000) return res.status(400).json({ error: 'bad prompt' });
    const parts = [{ text: prompt }, ...images.slice(0, 6).map(data => ({ inline_data: { mime_type: 'image/jpeg', data } }))];
    const text = await gemini(parts, { json: true });
    res.status(200).json({ text });
  } catch (e) { fail(res, e); }
}
