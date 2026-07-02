const CACHE_VERSION = 'write-nostr-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const CORE_ASSETS = [
	'/',
	'/index.html',
	'/manifest.webmanifest',
	'/robots.txt',
	'/brand/pen-logo-square.png',
	'/brand/pen-logo-compact.png',
	'/brand/pen-logo-flat.png',
	'/brand/pen-logo-svglike.png'
];

function isCacheableAsset(request) {
	const url = new URL(request.url);
	if (request.method !== 'GET') return false;
	if (url.origin !== self.location.origin) return false;
	return (
		url.pathname.startsWith('/_app/immutable/') ||
		url.pathname.startsWith('/brand/') ||
		url.pathname === '/manifest.webmanifest' ||
		url.pathname === '/robots.txt' ||
		url.pathname === '/favicon.svg' ||
		request.destination === 'style' ||
		request.destination === 'script' ||
		request.destination === 'image' ||
		request.destination === 'font'
	);
}

async function cacheFirst(request) {
	const cache = await caches.open(RUNTIME_CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) {
		cache.put(request, response.clone());
	}
	return response;
}

async function networkFirstNavigation(request) {
	const cache = await caches.open(SHELL_CACHE);
	try {
		const response = await fetch(request);
		if (response.ok) {
			cache.put('/index.html', response.clone());
		}
		return response;
	} catch {
		const cached = await cache.match('/index.html');
		if (cached) return cached;
		return cache.match('/');
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(SHELL_CACHE);
			await cache.addAll(CORE_ASSETS);
			self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key.startsWith('write-nostr-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
					.map((key) => caches.delete(key))
			);
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const request = event.request;
	if (request.mode === 'navigate') {
		event.respondWith(networkFirstNavigation(request));
		return;
	}

	if (isCacheableAsset(request)) {
		event.respondWith(cacheFirst(request));
	}
});
