// Shared Gemini caller. The API key lives only on the server (Vercel env var GEMINI_API_KEY).
const MODELS = (process.env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.0-flash').split(',').map(s => s.trim()).filter(Boolean);

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
    // Model missing or overloaded: try the next one. Quota or bad key: stop.
    if (![404, 500, 503].includes(r.status)) break;
  }
  throw last;
}

export function fail(res, e) {
  const status = e.status === 429 ? 429 : e.status === 503 ? 503 : 502;
  res.status(status).json({ error: String(e.message || e).slice(0, 300) });
}
