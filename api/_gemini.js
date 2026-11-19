// Shared Gemini caller. The API key lives only on the server (Vercel env var GEMINI_API_KEY).
// Tried in order; if one is busy (503), missing (404) or out of free quota (429), the next one is used.
const MODELS = (process.env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-flash-latest,gemini-3.5-flash,gemini-flash-lite-latest').split(',').map(s => s.trim()).filter(Boolean);

export async function gemini(parts, { json = false, temperature = 0.3 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY is not set'), { status: 503 });
  let last;
  for (const model of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) }
      })
    });
    if (r.ok) {
      const j = await r.json();
      return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    }
    last = Object.assign(new Error(`Gemini ${model} ${r.status}: ${(await r.text()).slice(0, 300)}`), { status: r.status });
    // Model missing, overloaded or out of quota: try the next one. Bad key or bad request: stop.
    if (![404, 429, 500, 503].includes(r.status)) break;
  }
  throw last;
}

export function fail(res, e) {
  const status = e.status === 429 ? 429 : e.status === 503 ? 503 : 502;
  res.status(status).json({ error: String(e.message || e).slice(0, 300) });
}
