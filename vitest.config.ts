import { configDefaults, defineConfig } from 'vitest/config';

// local-asr/runtime holds llama.cpp's source, whose own UI tests are not this site's.
export default defineConfig({
	test: { exclude: [...configDefaults.exclude, 'local-asr/**'] },
});
