import Anthropic from '@anthropic-ai/sdk';

export function makeClaude(cfg) {
  const client = new Anthropic({ apiKey: cfg.anthropicKey });
  return {
    async ask({ system, user, maxTokens }) {
      const res = await client.messages.create({
        model: cfg.model,
        max_tokens: maxTokens ?? cfg.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      });
      return res.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
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
