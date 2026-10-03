import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { get } from 'svelte/store';
import { auth, type Signer } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';

export const DEFAULT_BLOSSOM_SERVERS = [
	'https://blossom.nostr.build',
	'https://blossom.primal.net'
];

export type BlossomSettings = { servers: string[] };

function settingsKey(pubkey: string) {
	return `write_blossom_${pubkey}`;
}

function normalizeServer(value: string): string | null {
	try {
		const url = new URL(value.trim());
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
		return url.toString().replace(/\/$/, '');
	} catch {
		return null;
	}
}

function uniqueServers(values: string[]): string[] {
	return [...new Set(values.map(normalizeServer).filter((url): url is string => Boolean(url)))];
}

export function loadBlossomSettings(pubkey: string | null): BlossomSettings {
	if (typeof localStorage === 'undefined' || !pubkey) return { servers: [...DEFAULT_BLOSSOM_SERVERS] };
	try {
		const saved = JSON.parse(localStorage.getItem(settingsKey(pubkey)) || 'null');
		return { servers: Array.isArray(saved?.servers) ? uniqueServers(saved.servers.filter((v: unknown): v is string => typeof v === 'string')) : [...DEFAULT_BLOSSOM_SERVERS] };
	} catch {
		return { servers: [...DEFAULT_BLOSSOM_SERVERS] };
	}
}

export function saveBlossomSettings(pubkey: string | null, settings: BlossomSettings): void {
	if (typeof localStorage === 'undefined' || !pubkey) return;
	localStorage.setItem(settingsKey(pubkey), JSON.stringify({ servers: uniqueServers(settings.servers) }));
}

export async function fetchBlossomServerList(pubkey: string, relayUrls: string[] = get(relays)): Promise<string[]> {
	const pool = new SimplePool();
	try {
		const events = await pool.querySync(relayUrls, { kinds: [10063], authors: [pubkey], limit: 1 });
		const event = events.sort((a, b) => b.created_at - a.created_at)[0];
		return uniqueServers((event?.tags ?? []).filter(([key]) => key === 'server').map(([, value]) => value || ''));
	} finally {
		pool.destroy();
	}
}

export async function getUploadServers(pubkey: string): Promise<string[]> {
	const preferred = await fetchBlossomServerList(pubkey).catch(() => []);
	const configured = loadBlossomSettings(pubkey).servers;
	return uniqueServers(preferred.length ? [...preferred, ...configured] : configured);
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function uploadToServer(file: File, server: string, signer: Signer): Promise<string> {
	const data = await file.arrayBuffer();
	const hash = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
	const serverHost = new URL(server).hostname.toLowerCase();
	const now = Math.floor(Date.now() / 1000);
	const token: NostrEvent = {
		kind: 24242,
		created_at: now,
		content: 'Upload image',
		tags: [
			['t', 'upload'],
			['expiration', String(now + 300)],
			['server', serverHost],
			['x', hash]
		],
		pubkey: signer.pubkey
	} as NostrEvent;
	const signed = await signer.sign(token);
	const response = await fetch(`${server}/upload`, {
		method: 'PUT',
		headers: {
			Authorization: `Nostr ${base64Url(JSON.stringify(signed))}`,
			'Content-Type': file.type || 'application/octet-stream',
			'X-SHA-256': hash
		},
		body: file
	});
	if (!response.ok) {
		const reason = response.headers.get('X-Reason');
		const detail = await response.text().catch(() => '');
		throw new Error(reason || detail || `Upload rejected (HTTP ${response.status})`);
	}
	const descriptor = await response.json().catch(() => null) as { url?: unknown } | null;
	if (typeof descriptor?.url !== 'string' || !/^https?:\/\//i.test(descriptor.url)) {
		throw new Error('Blossom server returned an invalid image URL.');
	}
	return descriptor.url;
}

export async function convertImageToWebp(file: File): Promise<File> {
	if (file.type === 'image/webp' || file.type === 'image/gif') return file;
	let bitmap: ImageBitmap | null = null;
	try {
		bitmap = await createImageBitmap(file);
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('This device could not prepare the image for WebP conversion.');
		context.drawImage(bitmap, 0, 0);
		const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
		if (!converted || converted.type !== 'image/webp') {
			throw new Error('This device does not support WebP conversion. The image was not uploaded.');
		}
		const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
		return new File([converted], `${stem}.webp`, { type: 'image/webp', lastModified: file.lastModified });
	} catch (error) {
		if (error instanceof Error && error.message.includes('WebP')) throw error;
		throw new Error(`Could not convert ${file.name} to WebP: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		bitmap?.close();
	}
}

export async function uploadImage(file: File): Promise<string> {
	if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
	const signer = get(auth);
	if (!signer) throw new Error('Log in before uploading images.');
	file = await convertImageToWebp(file);
	const servers = await getUploadServers(signer.pubkey);
	if (!servers.length) throw new Error('Add a Blossom server in Settings before uploading images.');
	const errors: string[] = [];
	for (const server of servers) {
		try {
			return await uploadToServer(file, server, signer);
		} catch (error) {
			errors.push(`${server}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	throw new Error(`Could not upload image to any Blossom server. ${errors.join(' | ')}`);
}
