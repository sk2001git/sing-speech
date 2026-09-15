/**
 * The slice of the `ws` package that probe-route.ts uses. `ws` is present only as a
 * dependency of wrangler, without types; adding @types/ws would change package.json.
 */
declare module 'ws' {
	export default class WebSocket {
		constructor(url: string, options?: { headers?: Record<string, string> });
		once(event: 'open', fn: () => void): this;
		once(event: 'error', fn: (err: Error) => void): this;
		once(event: 'unexpected-response', fn: (req: unknown, res: { statusCode?: number }) => void): this;
		on(event: 'message', fn: (data: { toString(): string }) => void): this;
		send(data: string): void;
		close(): void;
	}
}
