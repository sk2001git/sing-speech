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
