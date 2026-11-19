// Shared Gemini caller. The API key lives only on the server (Vercel env var GEMINI_API_KEY).
// Models are tried in order. Busy (503), missing (404), out of free quota (429) or too slow: the next one is used.
// Fastest first: flash-lite answers Kaapo-size requests in ~1-2 s; bigger models are fallbacks.
const MODELS = (process.env.GEMINI_MODEL || 'gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.8-flash,gemini-flash-latest')
  .split(',').map(s => s.trim()).filter(Boolean);
const BUDGET_MS = 52000;   // stay under Vercel's 60 s function limit
const PER_MODEL_MS = 22000;

export async function gemini(parts, { json = false, temperature = 0.3, system = '', maxTokens = 0 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY is not set'), { status: 503 });
  const t0 = Date.now();
  let last;
  for (const model of MODELS) {
    const left = BUDGET_MS - (Date.now() - t0);
    if (left < 4000) break;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.min(PER_MODEL_MS, left));
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature, ...(maxTokens ? { maxOutputTokens: maxTokens } : {}), ...(json ? { responseMimeType: 'application/json' } : {}) }
        })
      });
      if (r.ok) {
        const j = await r.json();
        return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      }
      last = Object.assign(new Error(`Gemini ${model} ${r.status}: ${(await r.text()).slice(0, 300)}`), { status: r.status });
      // Bad key or bad request: no point trying other models.
      if (![404, 429, 500, 503].includes(r.status)) break;
    } catch (e) {
      last = Object.assign(new Error(`Gemini ${model} timed out`), { status: 503 });
    } finally { clearTimeout(timer) }
  }
  throw last || Object.assign(new Error('AI is busy, try again in a minute'), { status: 503 });
}

export function fail(res, e) {
  const status = e.status === 429 ? 429 : e.status === 503 ? 503 : 502;
  res.status(status).json({ error: String(e.message || e).slice(0, 300) });
}
