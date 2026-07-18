import { FeatureHashEmbedding } from '@0xx0lostcause0xx0/polypack';
import type { NostrEvent } from 'nostr-tools';

const DIMS = 384;

const _embedding = new FeatureHashEmbedding({ dimensions: DIMS });

export async function getEmbedding(text: string): Promise<Float64Array> {
	return _embedding.embed(text);
}

export function getArticleText(event: NostrEvent): string {
	const title = event.tags.find(([k]) => k === 'title')?.[1] || '';
	const summary = event.tags.find(([k]) => k === 'summary')?.[1] || '';
	const content = event.content || '';
	const plain = content.replace(/<[^>]+>/g, '').replace(/[#*_~`>|\\-]+/g, ' ').replace(/\n+/g, ' ').trim();
	return [title, summary, plain.slice(0, 2000)].filter(Boolean).join(' ');
}
