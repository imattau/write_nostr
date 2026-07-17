import type { NostrEvent } from 'nostr-tools';
import { pipeline } from '@xenova/transformers';

type ExtractPipeline = (texts: string | string[], options?: { pooling?: string; normalize?: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

let _pipe: ExtractPipeline | null = null;
let _pipePromise: Promise<void> | null = null;
let _loading = false;
let _ready = false;

export function isEmbeddingReady(): boolean {
	return _ready;
}

export function isEmbeddingLoading(): boolean {
	return _loading;
}

export function onEmbeddingReady(cb: () => void): boolean {
	if (_ready) { cb(); return true; }
	const origResolve = _resolveReady;
	_resolveReady = () => { cb(); origResolve?.(); };
	return false;
}

let _resolveReady: (() => void) | null = null;

async function getPipeline(): Promise<ExtractPipeline> {
	if (_pipe) return _pipe;
	if (_pipePromise) { await _pipePromise; return _pipe!; }
	_loading = true;
	_pipePromise = new Promise<void>((resolve) => {
		const prevResolve = _resolveReady;
		_resolveReady = () => { prevResolve?.(); resolve(); };
	});
	try {
		_pipe = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
			quantized: true
		})) as unknown as ExtractPipeline;
		_ready = true;
	} catch (e) {
		_pipePromise = null;
		_pipe = null;
		throw e;
	} finally {
		_loading = false;
		_resolveReady?.();
	}
	await _pipePromise;
	return _pipe!;
}

export async function getEmbedding(text: string): Promise<Float64Array> {
	const pipe = await getPipeline();
	const result = await pipe(text, { pooling: 'mean', normalize: true });
	return new Float64Array(result.data);
}

const SSR_GUARD = typeof window === 'undefined';
if (SSR_GUARD) {
	// Prevent SSR from downloading the model; it will be initialized on first browser call
}

export function getArticleText(event: NostrEvent): string {
	const title = event.tags.find(([k]) => k === 'title')?.[1] || '';
	const summary = event.tags.find(([k]) => k === 'summary')?.[1] || '';
	const content = event.content || '';
	const plain = content.replace(/<[^>]+>/g, '').replace(/[#*_~`>|\\-]+/g, ' ').replace(/\n+/g, ' ').trim();
	return [title, summary, plain.slice(0, 2000)].filter(Boolean).join(' ');
}
