#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', 'build');

const MIME = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.webmanifest': 'application/manifest+json',
	'.txt': 'text/plain',
};

function serve(req, res) {
	let path = join(root, req.url === '/' ? 'index.html' : req.url);

	if (!existsSync(path)) {
		path = join(root, 'index.html');
	}

	try {
		const stat = statSync(path);
		const ext = extname(path);
		const type = MIME[ext] || 'application/octet-stream';
		const content = readFileSync(path);
		res.writeHead(200, {
			'Content-Type': type,
			'Content-Length': stat.size,
			'Cache-Control': 'no-store',
		});
		res.end(content);
	} catch {
		res.writeHead(404);
		res.end('Not found');
	}
}

const port = parseInt(process.env.PORT, 10) || 3000;
createServer(serve).listen(port, () => {
	console.log(`write_nostr running at http://localhost:${port}`);
});
