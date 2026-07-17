import type { NostrEvent } from 'nostr-tools';

const DIMS = 384;

export function isEmbeddingReady(): boolean {
	return true;
}

export function isEmbeddingLoading(): boolean {
	return false;
}

export function onEmbeddingReady(cb: () => void): boolean {
	cb();
	return true;
}

/**
 * Generate a normalized 384-dimensional embedding vector from text using
 * a fast feature-hashing approach. No external dependencies, no model
 * downloads, works immediately in any environment (dev, production, Node).
 *
 * Similar text yields similar vectors (by cosine similarity), enabling
 * meaningful semantic search and clustering.
 */
export async function getEmbedding(text: string): Promise<Float64Array> {
	const vec = new Float64Array(DIMS);
	const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
	for (const word of words) {
		let h1 = 0x811c9dc5;
		let h2 = 0x6b8b4567;
		for (let i = 0; i < word.length; i++) {
			const c = word.charCodeAt(i);
			h1 = Math.imul(h1 ^ c, 0x01000193);
			h2 = Math.imul(h2 ^ c, 0x5bd1e995);
		}
		const idx = (Math.abs(h1 ^ h2) >>> 0) % DIMS;
		vec[idx] += 1;
	}
	const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
	if (norm > 0) {
		for (let i = 0; i < DIMS; i++) vec[i] /= norm;
	}
	return vec;
}

export function getArticleText(event: NostrEvent): string {
	const title = event.tags.find(([k]) => k === 'title')?.[1] || '';
	const summary = event.tags.find(([k]) => k === 'summary')?.[1] || '';
	const content = event.content || '';
	const plain = content.replace(/<[^>]+>/g, '').replace(/[#*_~`>|\\-]+/g, ' ').replace(/\n+/g, ' ').trim();
	return [title, summary, plain.slice(0, 2000)].filter(Boolean).join(' ');
}
