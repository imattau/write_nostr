import { FeatureHashEmbedding, buildEmbeddingText } from '@0xx0lostcause0xx0/polypack';
import type { NostrEvent } from 'nostr-tools';
import { getPersistedEventsByKind, indexEventVector } from '$lib/graph';

const DIMS = 384;
const DEFAULT_EMBEDDING_VERSION = 'feature-hash-384-v1';

export interface EmbeddingProvider {
	readonly version: string;
	readonly dimensions: number;
	embed(text: string): Promise<Float64Array> | Float64Array;
}

const baselineEmbedding = new FeatureHashEmbedding({ dimensions: DIMS });
let activeProvider: EmbeddingProvider = {
	version: DEFAULT_EMBEDDING_VERSION,
	dimensions: DIMS,
	embed: (text) => baselineEmbedding.embed(text)
};

export function setEmbeddingProvider(provider: EmbeddingProvider): void {
	if (provider.dimensions !== DIMS) {
		throw new RangeError(`Embedding provider must produce ${DIMS}-dimensional vectors`);
	}
	activeProvider = provider;
}

export function getEmbeddingProvider(): EmbeddingProvider {
	return activeProvider;
}

export async function getEmbedding(text: string): Promise<Float64Array> {
	return activeProvider.embed(text);
}

/** Stable input fingerprint used to detect stale vectors after content changes. */
export function embeddingTextHash(text: string): string {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Rebuild persisted article vectors after a provider becomes available. */
export async function reindexPersistedArticleEmbeddings(): Promise<void> {
	const events = await getPersistedEventsByKind(30023);
	for (let i = 0; i < events.length; i += 4) {
		await Promise.all(events.slice(i, i + 4).map(async (event) => {
			const text = getArticleText(event);
			if (!text) return;
			await indexEventVector(event.id, await getEmbedding(text), {
				embeddingVersion: activeProvider.version,
				embeddingTextHash: embeddingTextHash(text)
			});
		}));
		// Give rendering and user input a chance between reindex batches.
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}

export function getArticleText(event: NostrEvent): string {
	const content = (event.content || '').replace(/<[^>]+>/g, '').replace(/[#*_~`>|\\-]+/g, ' ').replace(/\n+/g, ' ').trim();
	return buildEmbeddingText({
		title: event.tags.find(([k]) => k === 'title')?.[1] || '',
		summary: event.tags.find(([k]) => k === 'summary')?.[1] || '',
		content: content.slice(0, 2000),
	}, { title: 3, summary: 2 });
}
