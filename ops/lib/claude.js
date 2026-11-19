// AI layer for the Ovrix service agents. The agents call `claude.ask(...)`; on Vercel this runs on Gemini
// (the same GEMINI_API_KEY Kaapo uses), with the fast-first model fallback in api/_gemini.js.
import { gemini } from '../../api/_gemini.js';

export function makeClaude(cfg = {}) {
  return {
    async ask({ system, user, maxTokens }) {
      const text = await gemini([{ text: user }], { system, temperature: 0.3, maxTokens: maxTokens ?? cfg.maxTokens ?? 1800 });
      return String(text || '').trim();
    },
  };
}

/** Pull the first JSON object out of a model reply (tolerates prose or code fences around it). */
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model output contained no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Wrap untrusted client text in a tag. Angle brackets inside the text are neutralised so a brief
 * cannot close the tag early and smuggle in fake instructions.
 */
export function untrusted(tag, fields) {
  const safe = (v) => String(v ?? '').replaceAll('<', '‹').replaceAll('>', '›');
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}: ${safe(v)}`)
    .join('\n');
  return `<${tag}>\n${body}\n</${tag}>`;
}
