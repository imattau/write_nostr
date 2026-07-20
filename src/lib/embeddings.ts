import { FeatureHashEmbedding, buildEmbeddingText } from '@0xx0lostcause0xx0/polypack';
import type { NostrEvent } from 'nostr-tools';

const DIMS = 384;

const _embedding = new FeatureHashEmbedding({ dimensions: DIMS });

export async function getEmbedding(text: string): Promise<Float64Array> {
	return _embedding.embed(text);
}

export function getArticleText(event: NostrEvent): string {
	const content = (event.content || '').replace(/<[^>]+>/g, '').replace(/[#*_~`>|\\-]+/g, ' ').replace(/\n+/g, ' ').trim();
	return buildEmbeddingText({
		title: event.tags.find(([k]) => k === 'title')?.[1] || '',
		summary: event.tags.find(([k]) => k === 'summary')?.[1] || '',
		content: content.slice(0, 2000),
	}, { title: 3, summary: 2 });
}
