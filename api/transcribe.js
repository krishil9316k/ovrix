import { gemini, fail } from './_gemini.js';

const SCRIPT = {
  gu: 'The speaker uses Gujarati: write it in Gujarati script.',
  hi: 'The speaker uses Hindi: write it in Devanagari script.',
  hinglish: 'Write Hindi words in English (Latin) letters, Hinglish style, as people type on Instagram.',
  en: 'Write it in English.'
};

// POST /api/transcribe { audio: base64 16 kHz mono WAV (<= ~55 s), lang?: gu|hi|hinglish|en }
// -> { segments: [{ start, end, text }] } with seconds from the start of this clip
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { audio, lang = '' } = req.body || {};
    if (typeof audio !== 'string' || audio.length > 4_000_000) return res.status(400).json({ error: 'bad audio' });
    const prompt = `Transcribe every spoken word in this audio exactly as said; do not translate, summarise or add words.
${SCRIPT[lang] || 'Detect the language. Gujarati goes in Gujarati script, Hindi in Devanagari, English in English; keep mixed Hinglish as spoken.'}
Return ONLY JSON: {"segments":[{"start":number,"end":number,"text":string}]}.
Times are seconds from the start of this audio. Keep each segment short (at most 8 words) and in order.
If there is no speech, return {"segments":[]}.`;
    const text = await gemini([{ text: prompt }, { inline_data: { mime_type: 'audio/wav', data: audio } }], { json: true, temperature: 0 });
    let segments = [];
    try {
      const j = JSON.parse(text.replace(/```(json)?/g, ''));
      segments = (Array.isArray(j) ? j : j.segments || []).filter(s => s && s.text);
    } catch { segments = []; }
    res.status(200).json({ segments });
  } catch (e) { fail(res, e); }
}
