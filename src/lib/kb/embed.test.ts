import { describe, expect, it } from 'vitest';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';
import { parseEntry } from './entry';
import { cosine, documentTexts, nearest, queryText } from './embed';

function entry() {
	const r = parseEntry(structuredClone(example));
	if (!r.ok) throw new Error(r.errors.join('\n'));
	return r.entry;
}

describe('queryText', () => {
	it('puts the retrieval instruction in the text, because OpenRouter ignores input_type for Qwen3', () => {
		const q = queryText('Doctor sent me to A&E, is it cheaper?');
		expect(q).toMatch(/^Instruct: .+\nQuery:Doctor sent me to A&E, is it cheaper\?$/);
	});
});

describe('documentTexts', () => {
	it('embeds the answer once without an instruction, then each example phrasing as a query', () => {
		const e = entry();
		const texts = documentTexts(e);
		expect(texts).toHaveLength(1 + e.search.example_phrasings.length);
		expect(texts[0]).toContain(e.title.full);
		expect(texts[0]).toContain(e.summary.text);
		expect(texts[0]).toContain(e.steps![0]!.name);
		expect(texts[0]).not.toContain('Instruct:');
		expect(texts[1]).toBe(queryText(e.search.example_phrasings[0]!));
	});
});

describe('cosine and nearest', () => {
	it('scores identical direction 1 and perpendicular 0', () => {
		expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
		expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
	});

	it('scores every stored vector against the query', () => {
		const hits = nearest([1, 0], [
			{ entryId: 'sg.moh.a', vector: [1, 0] },
			{ entryId: 'sg.moh.b', vector: [0, 1] },
		]);
		expect(hits.map((h) => [h.entryId, Math.round(h.score)])).toEqual([
			['sg.moh.a', 1],
			['sg.moh.b', 0],
		]);
	});
});
