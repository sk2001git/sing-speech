// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Unlike my-blog, this site takes the Cloudflare adapter on purpose. my-blog is fully
 * prerendered and deliberately ships no adapter; suara needs a server runtime because
 * every voice turn is a POST that calls a model. Static output is not an option here.
 */
export default defineConfig({
	site: 'https://suara.sg',
	output: 'server',
	adapter: cloudflare(),
	integrations: [react()],
	vite: {
		plugins: [tailwindcss()],
		/*
		 * The same trap on the browser side (2026-09-27): zod reaches the page only through
		 * JourneyView -> lib/kb/journey.ts, so Vite discovered it after the first page load and
		 * re-bundled it under a new hash that was never written. The import 404'd, React never
		 * hydrated, and every button on the page was inert until .vite/deps was deleted by hand.
		 * Bundled at startup instead, it is never discovered late.
		 */
		optimizeDeps: {
			include: ['zod'],
		},
		/*
		 * local-asr/runtime holds a Python venv and llama.cpp's own source, web UI included:
		 * tens of thousands of files that are not this site. Watching them slowed the dev server
		 * past Astro's 30 s start limit.
		 */
		server: {
			watch: { ignored: ['**/local-asr/**'] },
		},
		ssr: {
			/*
			 * The dev server kept dying with "The file does not exist at
			 * node_modules/.vite/deps_ssr/@astrojs_cloudflare_entrypoints_server.js": Vite
			 * re-optimises dependencies on a reload and writes a new hash, while the worker
			 * runner still holds the old path, so every request 500s until the cache is
			 * deleted by hand. The adapter's entrypoint does not need pre-bundling, so it is
			 * excluded rather than re-hashed.
			 */
			optimizeDeps: {
				exclude: ['@astrojs/cloudflare/entrypoints/server'],
			},
		},
	},
});
