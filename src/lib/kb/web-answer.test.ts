import { describe, expect, it } from 'vitest';
import { cleanText, groundAnswer, readStream, searchWeb, seenUrls, webAllowed, webRequestBody, type RawWebAnswer, type WebStage } from './web-answer';

/** A reply shaped like the spike's real gpt-6-luna runs (vault obs-0049). */
const raw = (over: Partial<RawWebAnswer> = {}): RawWebAnswer => ({
	kind: 'steps',
	title_short: 'Buy Bitcoin',
	title_full: 'How to buy Bitcoin on Coinbase',
	summary: 'Verify your account, add a payment method, then review and buy.',
	answer: '',
	answer_urls: [],
	prerequisites: 'You need a verified Coinbase account.',
	steps: [
		{ name: 'Add a payment method', text: 'Add a Singapore debit card.', confirm_label: 'Card added', source_urls: ['https://help.coinbase.com/en/pay?utm_source=openai'] },
		{ name: 'Review and buy', text: 'Tap Buy now.', confirm_label: 'Purchase complete', source_urls: ['https://help.coinbase.com/en/buy'] },
		{ name: 'Invented step', text: 'Something the search never saw.', confirm_label: 'Done', source_urls: ['https://example.com/made-up'] },
	],
	legal: { applies: true, text: 'Coinbase Singapore is licensed by MAS.', source_urls: ['https://eservices.mas.gov.sg/fid/institution'] },
	disclaimer: 'Not financial advice.',
	sources: [
		{ url: 'https://help.coinbase.com/en/pay', title: 'Payment methods', site: 'Coinbase Help' },
		{ url: 'https://help.coinbase.com/en/buy', title: 'How do I buy crypto?', site: 'Coinbase Help' },
		{ url: 'https://example.com/made-up', title: 'Made up', site: 'Example' },
		{ url: 'https://eservices.mas.gov.sg/fid/institution', title: 'Financial Institutions Directory', site: 'MAS' },
	],
	cautions: ['Prices move.'],
	figures: { caption: '', label_heading: '', value_heading: '', better: 'neither', rows: [] },
	...over,
});
const SEEN = new Set(['https://help.coinbase.com/en/pay', 'https://help.coinbase.com/en/buy', 'https://eservices.mas.gov.sg/fid/institution']);

describe('cleanText', () => {
	it('strips the citation markup the search tool adds, keeping the words', () => {
		expect(cleanText('At 55, savings go to your OA.([cpf.gov.sg](https://www.cpf.gov.sg/x?utm_source=openai))')).toBe('At 55, savings go to your OA.');
		expect(cleanText('Use a cycling path. See: https://www.lta.gov.sg/a.pdf ; https://www.lta.gov.sg/b.html')).toBe('Use a cycling path.');
		expect(cleanText('The **Ordinary Account (OA)** is for housing.')).toBe('The Ordinary Account (OA) is for housing.');
		expect(cleanText('Read [the guide](https://x.com/y) first.')).toBe('Read the guide first.');
	});
});

describe('groundAnswer', () => {
	it('keeps only steps whose every cited page the search saw, and counts what it dropped', () => {
		const a = groundAnswer(raw(), SEEN);
		expect(a.steps.map((s) => s.name)).toEqual(['Add a payment method', 'Review and buy']);
		expect(a.dropped).toBe(1);
		expect(a.kind).toBe('steps');
	});

	it('matches cited pages ignoring utm tags and fragments', () => {
		expect(groundAnswer(raw(), SEEN).steps[0]!.source_urls).toEqual(['https://help.coinbase.com/en/pay?utm_source=openai']);
	});

	it('lists only sources the search saw', () => {
		expect(groundAnswer(raw(), SEEN).sources.map((s) => s.site)).toEqual(['Coinbase Help', 'Coinbase Help', 'MAS']);
	});

	it('keeps a legal note only when its source was seen', () => {
		expect(groundAnswer(raw(), SEEN).legal.applies).toBe(true);
		expect(groundAnswer(raw(), new Set(['https://help.coinbase.com/en/pay', 'https://help.coinbase.com/en/buy'])).legal.applies).toBe(false);
	});

	it('turns a guide with no grounded steps into no answer', () => {
		expect(groundAnswer(raw(), new Set()).kind).toBe('none');
	});

	it('turns an answer whose pages were not seen into no answer', () => {
		const a = raw({ kind: 'answer', answer: 'No, not on footpaths.', answer_urls: ['https://www.lta.gov.sg/x'], steps: [] });
		expect(groundAnswer(a, new Set()).kind).toBe('none');
		expect(groundAnswer(a, new Set(['https://www.lta.gov.sg/x'])).kind).toBe('answer');
	});

	describe('figures', () => {
		// The owner's example, 2026-09-28: MOH bill estimates for five hospitals, written as a paragraph.
		const MOH = 'https://www.moh.gov.sg/cost-financing/fee-benchmarks-and-bill-amount-information';
		const row = (label: string, detail: string, value: string, number: number, source_urls = [MOH]) => ({ label, label_en: label, detail, value, number, source_urls });
		const bills = (rows: ReturnType<typeof row>[]) =>
			raw({
				kind: 'answer',
				answer: 'A subsidised ward bill is usually $2,400 to $4,300.',
				answer_urls: [MOH],
				steps: [],
				sources: [{ url: MOH, title: 'Bill amount information', site: 'Ministry of Health' }],
				figures: { caption: 'Typical bill after subsidy, before MediSave', label_heading: 'Hospital', value_heading: 'Bill', better: 'lower', rows },
			});
		const five = [
			row('Singapore General Hospital', 'B2 ward', '$4,320', 4320),
			row('Changi General Hospital', 'C ward', '$2,406', 2406),
			row('Sengkang General Hospital', 'C ward', '$3,690', 3690),
			row('Ng Teng Fong General Hospital', 'C ward', '$2,911', 2911),
			row('Singapore General Hospital', 'C ward', '$4,208', 4208),
		];

		it('keeps a comparison of three or more places as rows, best first', () => {
			const a = groundAnswer(bills(five), new Set([MOH]));
			expect(a.figures?.rows.map((r) => r.value)).toEqual(['$2,406', '$2,911', '$3,690', '$4,208', '$4,320']);
			expect(a.figures).toMatchObject({ caption: 'Typical bill after subsidy, before MediSave', better: 'lower' });
		});

		it('puts the highest first when higher is better', () => {
			const a = groundAnswer(bills(five.map((r) => ({ ...r }))), new Set([MOH]));
			const higher = groundAnswer({ ...bills(five), figures: { ...bills(five).figures, better: 'higher' } }, new Set([MOH]));
			expect(higher.figures?.rows[0]!.value).toBe('$4,320');
			expect(a.figures?.rows[0]!.value).toBe('$2,406');
		});

		it('drops a row whose page the search never saw, and the table when fewer than three remain', () => {
			const made = [...five.slice(0, 2), row('Made-up Hospital', 'C ward', '$999', 999, ['https://example.com/x'])];
			expect(groundAnswer(bills(made), new Set([MOH])).figures).toBeUndefined();
			const kept = groundAnswer(bills([...five, row('Made-up Hospital', 'C ward', '$999', 999, ['https://example.com/x'])]), new Set([MOH]));
			expect(kept.figures?.rows.map((r) => r.label)).not.toContain('Made-up Hospital');
			expect(kept.figures?.rows).toHaveLength(5);
		});

		it('uses the checked Chinese name of a public hospital, not the model’s guess', () => {
			// Live, 2026-09-28: the model wrote Ng Teng Fong General Hospital as 恩颂纪念医院.
			const zh = [
				{ ...row('樟宜综合医院', 'C级病房', '$2,406', 2406), label_en: 'Changi General Hospital' },
				{ ...row('恩颂纪念医院', 'C级病房', '$2,911', 2911), label_en: 'Ng Teng Fong General Hospital' },
				{ ...row('某社区医院', 'C级病房', '$3,000', 3000), label_en: 'Some Community Hospital' },
			];
			const a = groundAnswer(bills(zh), new Set([MOH]));
			expect(a.figures?.rows.map((r) => r.label)).toEqual(['樟宜综合医院', '黄廷方综合医院', '某社区医院']);
			// English labels stay as the model wrote them in full.
			expect(groundAnswer(bills(five), new Set([MOH])).figures?.rows[0]!.label).toBe('Changi General Hospital');
		});

		it('shows no table for steps, or for an answer with no rows', () => {
			expect(groundAnswer(raw(), SEEN).figures).toBeUndefined();
			expect(groundAnswer(bills([]), new Set([MOH])).figures).toBeUndefined();
		});

		it('asks the model for the figures, with names written out', () => {
			const body = webRequestBody('How much is the bill for pulmonary oedema?', 'en');
			expect(body.text.format.schema.required).toContain('figures');
			expect(body.input[0]!.content).toMatch(/figures/);
			expect(body.input[0]!.content).toMatch(/written out|in full/i);
		});
	});

	it('says official only when every kept page is a Singapore government site', () => {
		expect(groundAnswer(raw(), SEEN).official).toBe(false);
		const gov = raw({ kind: 'answer', answer: 'No.', answer_urls: ['https://www.lta.gov.sg/x'], steps: [], legal: { applies: false, text: '', source_urls: [] },
			sources: [{ url: 'https://www.lta.gov.sg/x', title: 'E-scooters', site: 'LTA' }] });
		expect(groundAnswer(gov, new Set(['https://www.lta.gov.sg/x'])).official).toBe(true);
	});

	it('cleans every text field', () => {
		const a = groundAnswer(raw({ summary: 'Buy it.([coinbase.com](https://coinbase.com))' }), SEEN);
		expect(a.summary).toBe('Buy it.');
	});
});

describe('webRequestBody', () => {
	it('asks Luna to search the web from Singapore and answer to a strict schema, streamed', () => {
		const body = webRequestBody('How do I buy bitcoin?', 'en');
		expect(body.model).toBe('gpt-6-luna');
		expect(body.stream).toBe(true);
		expect(body.tools).toEqual([{ type: 'web_search', user_location: { type: 'approximate', country: 'SG' } }]);
		expect(body.include).toEqual(['web_search_call.action.sources']);
		expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
	});

	it('asks for Chinese when the reader reads Chinese', () => {
		expect(JSON.stringify(webRequestBody('怎么买比特币？', 'zh-Hans').input)).toContain('Simplified Chinese');
	});
});

describe('seenUrls', () => {
	it('collects search results and opened pages', () => {
		const output = [
			{ type: 'web_search_call', action: { type: 'search', sources: [{ type: 'url', url: 'https://a.com/1' }] } },
			{ type: 'web_search_call', action: { type: 'open_page', url: 'https://b.com/2' } },
			{ type: 'message', content: [] },
		];
		expect([...seenUrls(output)].sort()).toEqual(['https://a.com/1', 'https://b.com/2']);
	});
});

describe('readStream', () => {
	const sse = (events: [string, unknown][]) =>
		new ReadableStream<Uint8Array>({
			start(c) {
				const enc = new TextEncoder();
				// split mid-event on purpose: chunks do not respect event boundaries
				const text = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
				c.enqueue(enc.encode(text.slice(0, 40)));
				c.enqueue(enc.encode(text.slice(40)));
				c.close();
			},
		});

	it('reports real stages as they happen and returns the finished response', async () => {
		const stages: WebStage[] = [];
		const done = await readStream(
			sse([
				['response.created', {}],
				['response.web_search_call.searching', {}],
				['response.output_item.done', { item: { type: 'web_search_call', action: { type: 'search', sources: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] } } }],
				['response.output_text.delta', { delta: '{' }],
				['response.output_text.delta', { delta: '}' }],
				['response.completed', { response: { output: [{ type: 'message' }] } }],
			]),
			(s) => stages.push(s),
		);
		expect(stages).toEqual([{ stage: 'searching' }, { stage: 'reading', pages: 3 }, { stage: 'writing' }]);
		expect(done).toEqual({ output: [{ type: 'message' }] });
	});

	it('fails plainly when the stream ends without a finished response', async () => {
		await expect(readStream(sse([['response.created', {}]]), () => {})).rejects.toThrow(/without a response/);
	});
});

describe('webAllowed', () => {
	it('is the OpenAI routes only', () => {
		expect(webAllowed('openai-ws')).toBe(true);
		expect(webAllowed('openai-live')).toBe(true);
		expect(webAllowed('gemini')).toBe(false);
	});
});

describe('searchWeb', () => {
	const events = (answer: RawWebAnswer | string) => {
		const output = [
			{ type: 'web_search_call', action: { type: 'search', sources: [...SEEN].map((url) => ({ type: 'url', url })) } },
			{ type: 'message', content: [{ type: 'output_text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] },
		];
		return [
			['response.web_search_call.searching', {}],
			['response.output_item.done', { item: output[0] }],
			['response.output_text.delta', { delta: '{' }],
			['response.completed', { response: { output } }],
		]
			.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
			.join('');
	};
	const fakeFetch = (status: number, body: string) => {
		const calls: { url: string; init: RequestInit }[] = [];
		const f = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(body, { status });
		}) as unknown as typeof fetch;
		return { f, calls };
	};

	it('asks OpenAI, reports stages, and returns the grounded answer', async () => {
		const { f, calls } = fakeFetch(200, events(raw()));
		const stages: WebStage[] = [];
		const a = await searchWeb('How do I buy bitcoin?', 'en', { apiKey: 'k', fetch: f, onStage: (s) => stages.push(s) });
		expect(calls[0]!.url).toBe('https://api.openai.com/v1/responses');
		expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer k');
		expect(stages.map((s) => s.stage)).toEqual(['searching', 'reading', 'writing']);
		expect(a.kind).toBe('steps');
		expect(a.dropped).toBe(1);
	});

	it('fails plainly on an error status, without the body', async () => {
		const { f } = fakeFetch(429, 'rate limited: secret details');
		await expect(searchWeb('q', 'en', { apiKey: 'k', fetch: f, onStage: () => {} })).rejects.toThrow(/^web search 429$/);
	});

	it('fails plainly when the reply is not the schema', async () => {
		const { f } = fakeFetch(200, events('not json'));
		await expect(searchWeb('q', 'en', { apiKey: 'k', fetch: f, onStage: () => {} })).rejects.toThrow(/not a web answer/);
	});
});
