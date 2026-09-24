#!/usr/bin/env node
/**
 * Spike, not product code: can Luna (gpt-6-luna by default; MODEL= to change) search the web, reason, and hand back a guide
 * with a variable number of steps, each step citing a page it actually found?
 *
 *   node scripts/kb/spike-web-steps.mjs "How do I book a hotel on Trip.com and earn its rewards?"
 *
 * Reads OPENAI_API_KEY from .env (never printed). Writes nothing but stdout. Reports:
 * latency, tokens, how many searches ran, the guide, and a grounding check: every step's
 * cited URLs must be among the pages the search tool returned.
 * Vault plan: suara-2026-09-25-feature-web-steps.
 */
import { readFileSync } from 'node:fs';

const key = (readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/^OPENAI_API_KEY=(.+)$/m)?.[1] ?? '').trim().replace(/^"|"$/g, '');
if (!key) { console.error('No OPENAI_API_KEY in .env'); process.exit(2); }
const question = process.argv[2] || 'How do I book a hotel on Trip.com and earn its rewards?';
const model = process.env.MODEL || 'gpt-6-luna'; // half gpt-5.6-luna's price, same AA index (vault obs-0049)
const tool = process.env.TOOL || 'web_search';
const effort = process.env.EFFORT || 'low';

const SYSTEM = `You help an older person in Singapore. Search the web, read the most
authoritative pages (the organisation's own help pages and official sources first), then answer.
Decide the kind:
- "steps" when they want to DO something: a short guide, as many steps as the task needs
  (2 for a simple thing, up to 10 for a long one), one action per step.
- "answer" when they want to KNOW something: a direct answer in plain words, no steps.
- "none" when you cannot find a reliable answer.
Rules:
- Only what the pages support. Every step, and the answer, cites the URL(s) it came from, copied exactly.
- prerequisites: what they must already have before starting, in ONE short plain sentence
  ("You need a verified Coinbase account and a Singapore debit card."). Empty string if nothing.
- legal: if Singapore law touches this at all (licences, regulated activities, tax, contracts,
  age limits, penalties, rules on where or how something may be done), set applies true and say
  plainly what the law means for them, citing the source. Otherwise applies false and empty text.
- disclaimer: one fine-print sentence fitting this topic (e.g. not financial, legal or medical
  advice; prices and rules change). Always give one.
- cautions: other things worth checking (fees, delays, scams). Short.
- Step name at most 40 characters, text at most 300, confirm_label at most 24 ("I have signed in").
- Plain text only in every field: no URLs, no markdown (no ** or links), no citation brackets.
  URLs go only in answer_urls, source_urls and sources.`;

const schema = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'title_short', 'title_full', 'summary', 'answer', 'answer_urls', 'prerequisites', 'steps', 'legal', 'disclaimer', 'sources', 'cautions'],
  properties: {
    kind: { type: 'string', enum: ['steps', 'answer', 'none'] },
    title_short: { type: 'string', description: 'At most 16 characters' },
    title_full: { type: 'string', description: 'At most 60 characters' },
    summary: { type: 'string', description: 'One sentence, at most 140 characters' },
    answer: { type: 'string', description: 'For kind answer: at most 600 characters, plain words. Empty otherwise.' },
    answer_urls: { type: 'array', items: { type: 'string' } },
    prerequisites: { type: 'string', description: 'One short sentence, or empty' },
    steps: { type: 'array', maxItems: 12, items: {
      type: 'object', additionalProperties: false, required: ['name', 'text', 'confirm_label', 'source_urls'],
      properties: { name: { type: 'string' }, text: { type: 'string' }, confirm_label: { type: 'string' },
        source_urls: { type: 'array', items: { type: 'string' } } } } },
    legal: { type: 'object', additionalProperties: false, required: ['applies', 'text', 'source_urls'],
      properties: { applies: { type: 'boolean' }, text: { type: 'string' }, source_urls: { type: 'array', items: { type: 'string' } } } },
    disclaimer: { type: 'string' },
    sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['url', 'title', 'site'],
      properties: { url: { type: 'string' }, title: { type: 'string' }, site: { type: 'string' } } } },
    cautions: { type: 'array', items: { type: 'string' } },
  },
};

const body = {
  model,
  reasoning: { effort },
  tools: [{ type: tool, user_location: { type: 'approximate', country: 'SG' } }],
  include: ['web_search_call.action.sources'],
  input: [{ role: 'system', content: SYSTEM }, { role: 'user', content: question }],
  text: { format: { type: 'json_schema', name: 'web_guide', strict: true, schema } },
  max_output_tokens: 6000,
};

const t0 = Date.now();
const res = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const ms = Date.now() - t0;
const json = await res.json();
if (!res.ok) { console.log(JSON.stringify({ status: res.status, error: json.error }, null, 2)); process.exit(1); }

const calls = (json.output ?? []).filter((o) => o.type === 'web_search_call');
// Pages the tool actually saw: search results, plus pages it opened or searched within directly.
const found = new Set(calls.flatMap((c) => [...(c.action?.sources ?? []).map((s) => s.url), ...(c.action?.url ? [c.action.url] : [])]));
const actions = calls.map((c) => c.action?.type);
const cited = new Set((json.output ?? []).flatMap((o) => (o.content ?? []).flatMap((c) => (c.annotations ?? []).filter((a) => a.type === 'url_citation').map((a) => a.url))));
const text = json.output_text ?? (json.output ?? []).flatMap((o) => (o.content ?? []).map((c) => c.text ?? '')).join('');
let guide = null; try { guide = JSON.parse(text); } catch { /* reported below */ }
// The search tool appends its own citation markup to text even when told not to:
// "([site](url))", markdown links, bare URLs, **bold**. Strip it; URLs live in the url fields.
let stripped = 0;
const clean = (t) => t
  .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, () => (stripped++, ''))
  .replace(/\[([^\]]+)\]\([^)]*\)/g, (_, label) => (stripped++, label))
  .replace(/\s*(?:See:?\s*)?https?:\/\/\S+(?:\s*[;,])?/g, () => (stripped++, ''))
  .replace(/\s+([.;,])/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, (_, x) => (stripped++, x))
  .replace(/\s{2,}/g, ' ').trim();
if (guide) {
  for (const k of ['title_short', 'title_full', 'summary', 'answer', 'prerequisites', 'disclaimer']) guide[k] = clean(guide[k]);
  guide.legal.text = clean(guide.legal.text);
  guide.cautions = guide.cautions.map(clean);
  for (const st of guide.steps) { st.name = clean(st.name); st.text = clean(st.text); st.confirm_label = clean(st.confirm_label); }
}
const norm = (u) => { try { const x = new URL(u); x.hash = ''; return x.origin + x.pathname.replace(/\/$/, ''); } catch { return u; } };
const foundN = new Set([...found].map(norm));
const seen = (urls) => ({ urls: urls.length, inSearchResults: urls.filter((u) => foundN.has(norm(u))).length });
const grounding = guide && [
  ...guide.steps.map((s, i) => ({ part: `step ${i + 1}`, ...seen(s.source_urls) })),
  ...(guide.kind === 'answer' ? [{ part: 'answer', ...seen(guide.answer_urls) }] : []),
  ...(guide.legal.applies ? [{ part: 'legal', ...seen(guide.legal.source_urls) }] : []),
];

console.log(JSON.stringify({
  model: json.model, tool, effort, ms, status: json.status,
  usage: json.usage, searches: calls.length, actions, queries: calls.map((c) => c.action?.query).filter(Boolean),
  pagesReturnedBySearch: found.size, urlCitations: cited.size,
  parsed: !!guide, strippedMarkup: stripped, kind: guide?.kind, steps: guide?.steps?.length, legal: guide?.legal?.applies, grounding,
}, null, 2));
console.log('\n--- guide ---\n' + (guide ? JSON.stringify(guide, null, 2) : text.slice(0, 2000)));
