import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

function findFreePort(start = 1420) {
	return new Promise((resolve) => {
		const tryPort = (port) => {
			const server = createServer();
			server.listen(port, '127.0.0.1', () => {
				server.close(() => resolve(port));
			});
			server.on('error', () => tryPort(port + 1));
		};
		tryPort(start);
	});
}

async function main() {
	const port = await findFreePort();
	const cwd = resolve(import.meta.dirname, '..');

	const args = ['run', 'dev', '--', '--port', String(port), '--strictPort'];

	const vite = spawn('npm', args, {
		cwd,
		stdio: ['ignore', 'pipe', 'inherit'],
		env: { ...process.env }
	});

	const configOverride = JSON.stringify({ build: { devUrl: `http://localhost:${port}` } });

	vite.stdout.on('data', (data) => {
		process.stdout.write(data);
		if (data.toString().includes('Local:')) {
			const tauri = spawn('npx', ['tauri', 'dev', '--config', configOverride], {
				cwd,
				stdio: 'inherit',
				env: { ...process.env }
			});

			tauri.on('exit', (code) => {
				vite.kill();
				process.exit(code ?? 0);
			});
		}
	});

	process.on('SIGINT', () => {
		vite.kill('SIGTERM');
		process.exit(0);
	});
}

main();
