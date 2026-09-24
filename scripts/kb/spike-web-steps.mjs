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

const SYSTEM = `You help an older person in Singapore do one practical thing, step by step.
Search the web, read the pages that are most authoritative for this (the company's own help
pages first), then write a short guide.
Rules:
- Only steps the pages support. Every step cites the URL(s) it came from, copied exactly.
- As many steps as the task needs, no more: 2 for a simple thing, up to 10 for a long one.
- Plain words, one action per step. Step name at most 40 characters, text at most 300,
  confirm_label is what they tap when the step is done, at most 24 characters ("I have signed in").
- If the pages disagree or something may have changed, say so in cautions.
- If you cannot find a reliable answer, set fit to "none" and give no steps.`;

const schema = {
  type: 'object', additionalProperties: false,
  required: ['fit', 'title_short', 'title_full', 'summary', 'steps', 'sources', 'cautions'],
  properties: {
    fit: { type: 'string', enum: ['good', 'partial', 'none'] },
    title_short: { type: 'string', description: 'At most 16 characters' },
    title_full: { type: 'string', description: 'At most 60 characters' },
    summary: { type: 'string', description: 'One sentence, at most 140 characters' },
    steps: { type: 'array', maxItems: 12, items: {
      type: 'object', additionalProperties: false, required: ['name', 'text', 'confirm_label', 'source_urls'],
      properties: { name: { type: 'string' }, text: { type: 'string' }, confirm_label: { type: 'string' },
        source_urls: { type: 'array', items: { type: 'string' } } } } },
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
const norm = (u) => { try { const x = new URL(u); x.hash = ''; return x.origin + x.pathname.replace(/\/$/, ''); } catch { return u; } };
const foundN = new Set([...found].map(norm));
const grounding = guide?.steps?.map((s, i) => ({ step: i + 1, urls: s.source_urls.length, inSearchResults: s.source_urls.filter((u) => foundN.has(norm(u))).length }));

console.log(JSON.stringify({
  model: json.model, tool, effort, ms, status: json.status,
  usage: json.usage, searches: calls.length, actions, queries: calls.map((c) => c.action?.query).filter(Boolean),
  pagesReturnedBySearch: found.size, urlCitations: cited.size,
  parsed: !!guide, fit: guide?.fit, steps: guide?.steps?.length, grounding,
}, null, 2));
console.log('\n--- guide ---\n' + (guide ? JSON.stringify(guide, null, 2) : text.slice(0, 2000)));
