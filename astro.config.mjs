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
	},
});
