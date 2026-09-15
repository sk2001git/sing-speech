import { describe, expect, it, vi } from 'vitest';
import { NothingHeard, type Hearing } from '../kb/hearing';
import { buildRoutes, DEFAULT_ROUTE, hearVia, resolveRoute, RouteUnavailable, type HearingRoute } from './index';

const heard: Hearing = { greeting: false, meaning_en: 'q', short: 's', sentence: 's', language: 'en', confidence: 0.9 };

const route = (id: string, hear: HearingRoute['hear']): HearingRoute => ({ id, vendor: id, label: id, hear });

describe('resolveRoute', () => {
	it('defaults to the OpenAI WebSocket route', () => {
		expect(DEFAULT_ROUTE).toBe('openai-ws');
		expect(resolveRoute(null, undefined)).toBe('openai-ws');
	});

	it('takes the configured default, and a per-request choice over it', () => {
		expect(resolveRoute(null, 'gemini')).toBe('gemini');
		expect(resolveRoute('openai-ws', 'gemini')).toBe('openai-ws');
	});

	it('ignores a route it does not know, rather than failing the page', () => {
		expect(resolveRoute('twilio', 'nope')).toBe('openai-ws');
	});
});

describe('buildRoutes', () => {
	it('puts the chosen route first and the others after it as failover', () => {
		const chain = buildRoutes('gemini', { OPENAI_API_KEY: 'k', GEMINI_API_KEY: 'g' });
		expect(chain.map((r) => r.id)).toEqual(['gemini', 'openai-ws']);
	});

	it('keeps a route with no key in the chain, so the reason it was skipped is reported', async () => {
		const chain = buildRoutes('openai-ws', { GEMINI_API_KEY: 'g' });
		expect(chain.map((r) => r.id)).toEqual(['openai-ws', 'gemini']);
		await expect(chain[0]!.hear(new ArrayBuffer(1))).rejects.toThrow(/OPENAI_API_KEY/);
	});
});

describe('hearVia', () => {
	it('uses the first route that hears, and says which one served', async () => {
		const r = await hearVia([route('a', async () => heard), route('b', async () => heard)], new ArrayBuffer(1));
		expect(r).toMatchObject({ route: 'a', hearing: heard, skipped: [] });
	});

	it('fails over to the next route and records why the first was skipped', async () => {
		const r = await hearVia(
			[
				route('openai-ws', async () => {
					throw new RouteUnavailable('openai-ws', 'missing-key', 'OPENAI_API_KEY is not set');
				}),
				route('gemini', async () => heard),
			],
			new ArrayBuffer(1),
		);
		expect(r.route).toBe('gemini');
		expect(r.skipped).toEqual([{ route: 'openai-ws', reason: 'missing-key' }]);
	});

	it('stops at a route that heard nothing, instead of asking the next vendor to hear silence', async () => {
		const second = vi.fn(async () => heard);
		const chain = [
			route('openai-ws', async () => {
				throw new RouteUnavailable('openai-ws', 'nothing-heard', 'empty transcript');
			}),
			route('gemini', second),
		];
		await expect(hearVia(chain, new ArrayBuffer(1))).rejects.toBeInstanceOf(NothingHeard);
		expect(second).not.toHaveBeenCalled();
	});

	it('fails when every route fails', async () => {
		const fail = async () => {
			throw new Error('down');
		};
		await expect(hearVia([route('a', fail), route('b', fail)], new ArrayBuffer(1))).rejects.toThrow(/every route failed/);
	});
});
