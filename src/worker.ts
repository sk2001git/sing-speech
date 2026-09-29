/**
 * The Worker: Astro's handler, plus the one Durable Object Suara needs, the daily budget
 * (vault plan-suara-0021, H4). `main` in wrangler.jsonc points here, as the Astro Cloudflare
 * adapter documents for exporting a Durable Object.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { DurableObject } from 'cloudflare:workers';
import { reserve, type Caps, type Ledger } from './lib/guard/ledger';

/**
 * One object per day, named by the date in Singapore. It runs one request at a time, so the
 * check and the spend are one step: two questions at once cannot both take the last cent.
 */
export class Budget extends DurableObject {
	async reserve(session: string, cost: number, caps: Caps): Promise<{ ok: boolean; reason?: 'day' | 'session' }> {
		const ledger = (await this.ctx.storage.get<Ledger>('ledger')) ?? { spent: 0, sessions: {} };
		const r = reserve(ledger, session, cost, caps);
		if (r.ok) await this.ctx.storage.put('ledger', r.ledger);
		return r.ok ? { ok: true } : { ok: false, reason: r.reason };
	}

	/** What has been reserved today, for the owner's screen and for checks. */
	async spent(): Promise<number> {
		return ((await this.ctx.storage.get<Ledger>('ledger')) ?? { spent: 0 }).spent;
	}
}

export default {
	fetch: (request, env, ctx) => handle(request, env, ctx),
} satisfies ExportedHandler<Env>;
