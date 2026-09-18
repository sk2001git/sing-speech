import { describe, expect, it } from 'vitest';
import { answerText, parseQuestions, questionUrls, readPayload } from './askgov';

/**
 * A question page is a Next.js RSC stream: the state arrives as JSON inside JS string
 * literals in self.__next_f.push([1,"..."]) and has to be unescaped before anything can be
 * read. `chunk` packages JSON the way the page does — `JSON.stringify` performs exactly the
 * JS-literal escaping the framework performs, including the `\"` inside every answer body,
 * which is what a first attempt at this fixture got wrong.
 */
const chunk = (jsonText: string) => `<script>self.__next_f.push([1,${JSON.stringify(jsonText)}])</script>`;

const unwell = `{"id":"clpjhtek000b510fdiofqshig","title":"I am a patient ≥ 60 years old. What should I do?","priority":0,"createdAt":"2023-11-29T08:16:27.095Z","updatedAt":"2026-08-19T07:23:21.189Z","published":true,"answer":{"id":"a1","body":"<p class=\\"x\\">See a doctor early.</p><p class=\\"x\\">&middot;&nbsp;&nbsp;Bring your NRIC &amp; card.</p>","numPositiveFeedback":219},"topics":[{"id":134,"title":"I am unwell","parentTopicId":820,"parentTopic":{"title":"Covid-19"}}]}`;

/** The same question again, shorter: every page also carries the top-questions widget. */
const unwellAgain = `{"id":"clpjhtek000b510fdiofqshig","title":"I am a patient ≥ 60 years old. What should I do?","answer":{"id":"a1","body":"<p>See a doctor early.</p>","numPositiveFeedback":219},"topics":[]}`;

const chas = `{"id":"cm8qljjgm00mx6vqhm53h5lk0","title":"How can I apply? (CHAS)","updatedAt":"2026-08-19T07:23:21.189Z","answer":{"id":"a2","body":"<ul><li>Apply online.</li><li>Or pick up a form at any CC.</li></ul>","numPositiveFeedback":43},"topics":[{"id":7,"title":"CHAS","parentTopic":null}]}`;

const page = [
	'<!DOCTYPE html><html><head><title>Ministry of Health | How can I apply? (CHAS)</title></head><body>',
	chunk('3:["$","div",null,{"children":['),
	chunk(unwell),
	chunk(unwellAgain),
	chunk(chas),
	'</body></html>',
].join('');

describe('readPayload', () => {
	it('decodes the escapes the framework writes, which a latin-1 unescape corrupts', () => {
		// Written by hand: the page carries non-ASCII as a JS-level \uXXXX escape, and the
		// answers are full of them \u2014 \u2265, \u00b7, curly quotes.
		const escaped = '<script>self.__next_f.push([1,"a patient \\u2265 60 years old"])</script>';
		expect(readPayload(escaped)).toBe('a patient \u2265 60 years old');
	});

	it('joins every chunk on the page', () => {
		expect(readPayload(page)).toContain('60 years old');
		expect(readPayload(page)).toContain('How can I apply? (CHAS)');
	});

	it('returns nothing for a page with no flight chunks', () => {
		expect(readPayload('<html><body>plain</body></html>')).toBe('');
	});
});

describe('answerText', () => {
	it('reads paragraphs as lines', () => {
		expect(answerText('<p>One.</p><p>Two.</p>')).toBe('One.\nTwo.');
	});

	it('decodes entities and drops the non-breaking space padding', () => {
		expect(answerText('<p>&middot;&nbsp;&nbsp;Bring your NRIC &amp; card.</p>')).toBe('· Bring your NRIC & card.');
	});

	it('keeps list items as their own lines', () => {
		expect(answerText('<ul><li>Apply online.</li><li>Or at any CC.</li></ul>')).toBe('Apply online.\nOr at any CC.');
	});

	it('keeps the text of a link, not its markup', () => {
		expect(answerText('<p>Apply <a href="https://chas.sg">using this link</a>.</p>')).toBe('Apply using this link.');
	});

	it('does not run two sentences together when a tag separates them', () => {
		expect(answerText('<p>One.</p><div>Two.</div>')).toBe('One.\nTwo.');
	});
});

describe('parseQuestions', () => {
	const found = parseQuestions(page);

	it('finds each question once, however many times the page repeats it', () => {
		expect(found.map((q) => q.id)).toEqual(['clpjhtek000b510fdiofqshig', 'cm8qljjgm00mx6vqhm53h5lk0']);
	});

	it('prefers the copy that carries the most detail', () => {
		const first = found[0]!;
		expect(first.topics).toEqual(['Covid-19 / I am unwell']);
		expect(first.text).toBe('See a doctor early.\n· Bring your NRIC & card.');
	});

	it('carries the usefulness count, which is the only published popularity signal', () => {
		expect(found.map((q) => q.useful)).toEqual([219, 43]);
	});

	it('carries the last-modified date, or null', () => {
		expect(found[0]!.updatedAt).toBe('2026-08-19T07:23:21.189Z');
		const undated = parseQuestions([chunk(unwell.replace(/"updatedAt":"[^"]*",/, ''))].join(''));
		expect(undated[0]!.updatedAt).toBeNull();
	});

	it('finds the question the page is actually about, whose object carries an empty body first', () => {
		// The page's own question arrives inside a react-query cache entry and is serialised
		// {"id","body","title",...}, not {"id","title",...} like the widget copies. A parser
		// that insists on the widget's key order silently drops every page's own answer.
		const own = chunk('{"dehydratedAt":1789666232000,"state":{"data":{"json":{"id":"clgx67vu7003hmf08wal8w0ah","body":"","title":"Where can I find the full list of CHAS GPs?","updatedAt":"2025-04-09T12:20:34.493Z","answer":{"id":"a9","body":"<p>The full list of CHAS GPs can be found here.</p>","numPositiveFeedback":1},"topics":[{"id":9,"title":"Making Appointments","parentTopic":null}]}}}}');
		const found = parseQuestions(own);
		expect(found.map((q) => q.id)).toEqual(['clgx67vu7003hmf08wal8w0ah']);
		expect(found[0]!.text).toBe('The full list of CHAS GPs can be found here.');
	});

	it('ignores an object that has no answer', () => {
		const agency = chunk('{"id":"clhou1j1a0004ky0887ejmat5","title":"Ministry of Health","code":"moh"}');
		expect(parseQuestions(agency)).toEqual([]);
	});
});

describe('questionUrls', () => {
	const sitemap = [
		'<?xml version="1.0" encoding="UTF-8"?><urlset>',
		'<url><loc>https://ask.gov.sg/moh</loc></url>',
		'<url><loc>https://ask.gov.sg/moh?topic=Covid-19&amp;subtopic=I+am+unwell</loc></url>',
		'<url><loc>https://ask.gov.sg/moh/questions/clpjhtek000b510fdiofqshig</loc></url>',
		'<url><loc>https://ask.gov.sg/moh/questions/cm8qljjgm00mx6vqhm53h5lk0</loc></url>',
		'</urlset>',
	].join('');

	it('takes the question pages and leaves the topic listings', () => {
		expect(questionUrls(sitemap)).toEqual([
			'https://ask.gov.sg/moh/questions/clpjhtek000b510fdiofqshig',
			'https://ask.gov.sg/moh/questions/cm8qljjgm00mx6vqhm53h5lk0',
		]);
	});

	it('returns each url once', () => {
		expect(questionUrls(sitemap + sitemap)).toHaveLength(2);
	});
});
