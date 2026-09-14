import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import schema from '../../../docs/knowledge-base/entry.schema.json';
import example from '../../../docs/knowledge-base/examples/sg.moh.gpfirst-emergency-referral.json';
import { parseEntry } from './entry';

type Json = Record<string, any>;

const AT = '2026-09-15T08:00:00Z';
const clone = (): Json => structuredClone(example) as Json;
const edit = (change: (e: Json) => void) => (): Json => {
	const e = clone();
	change(e);
	return e;
};

const translation = edit((e) => {
	e.language = 'zh-Hans';
	e.translation_of = { id: e.id, version: 1 };
	e.provenance.translated = { method: 'model', model: 'thinkingmachines/inkling:free', prompt_version: 'translate-1', at: AT };
});

const CASES: Array<[string, () => Json, boolean]> = [
	['the reviewed MOH example', clone, true],
	['an original listing a Chinese translation', edit((e) => (e.translations = { 'zh-Hans': { from_version: 1, at: AT } })), true],
	['a Chinese translation of the example', translation, true],
	['a process with no steps', edit((e) => delete e.steps), false],
	['an answer carrying steps', edit((e) => (e.kind = 'answer')), false],
	['a summary longer than one spoken line', edit((e) => (e.summary.text = 'a'.repeat(141))), false],
	['a grid title longer than 16 characters', edit((e) => (e.title.short = 'a'.repeat(17))), false],
	['a duplicated tag', edit((e) => (e.topic.tags = ['gpfirst', 'gpfirst'])), false],
	['a field the schema does not define', edit((e) => (e.notes = 'x')), false],
	['a source served over http', edit((e) => (e.sources[0].url = 'http://ask.gov.sg/moh')), false],
	['a summary citing no quote', edit((e) => (e.summary.quote_refs = [])), false],
	['an old schema version', edit((e) => (e.schema_version = '1.0.0')), false],
	['a translation into a language Suara does not serve', edit((e) => (e.translations = { ms: { from_version: 1, at: AT } })), false],
	['a translation that does not say which model made it', () => {
		const e = translation();
		delete e.provenance.translated;
		return e;
	}, false],
	['a translation listing translations of its own', () => {
		const e = translation();
		e.translations = { 'zh-Hans': { from_version: 1, at: AT } };
		return e;
	}, false],
	['an original claiming it was translated', edit((e) => {
		e.provenance.translated = { method: 'model', model: 'x', at: AT };
	}), false],
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateJsonSchema = ajv.compile(schema);

describe('parseEntry', () => {
	it.each(CASES)('%s', (_name, make, valid) => {
		const result = parseEntry(make());
		expect(result.ok, result.ok ? '' : result.errors.join('\n')).toBe(valid);
	});

	it('names the failing field, so a rejected model reply can be logged usefully', () => {
		const result = parseEntry(edit((e) => (e.title.short = 'a'.repeat(17)))());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join('\n')).toContain('title.short');
	});
});

describe('entry.ts agrees with entry.schema.json', () => {
	// The Worker validates with zod; reviewers read the JSON Schema. If they disagree on
	// any case, one of them is wrong and a model reply could pass one and fail the other.
	it.each(CASES)('%s', (_name, make, valid) => {
		expect(validateJsonSchema(make()), JSON.stringify(validateJsonSchema.errors)).toBe(valid);
	});
});
