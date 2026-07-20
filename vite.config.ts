import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

function suppressNodeExternalWarnings(): Plugin {
	const filter = [
		'Module "node:fs" has been externalized',
		'Module "node:path" has been externalized',
		'Module "node:fs/promises" has been externalized',
	];
	return {
		name: 'suppress-node-external-warnings',
		enforce: 'pre',
		configResolved(config) {
			const origWarn = config.logger.warn;
			config.logger.warn = (msg, options) => {
				if (filter.some(f => msg.includes(f))) return;
				origWarn(msg, options);
			};
		},
	};
}

export default defineConfig({
	plugins: [suppressNodeExternalWarnings(), sveltekit()],
	clearScreen: false,
	server: {
		watch: {
			ignored: ['**/src-tauri/**']
		}
	}
});
