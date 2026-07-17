import type { NostrEvent } from 'nostr-tools';

type ExtractPipeline = (texts: string | string[], options?: { pooling?: string; normalize?: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

let _pipe: ExtractPipeline | null = null;
let _pipePromise: Promise<void> | null = null;
let _loading = false;
let _ready = false;
let _pendingArticles: string[] = [];

export function isEmbeddingReady(): boolean {
	return _ready;
}

export function isEmbeddingLoading(): boolean {
	return _loading;
}

/**
 * Register a callback to fire once the embedding pipeline is ready.
 * Returns false if already ready (callback fires synchronously).
 */
export function onEmbeddingReady(cb: () => void): boolean {
	if (_ready) { cb(); return true; }
	const orig = _pipePromise;
	const origResolve = _resolveReady;
	_resolveReady = () => { cb(); origResolve?.(); };
	return false;
}

let _resolveReady: (() => void) | null = null;

async function getPipeline(): Promise<ExtractPipeline> {
	if (typeof window === 'undefined') throw new Error('Embeddings unavailable server-side');
	if (_pipe) return _pipe;
	if (_pipePromise) { await _pipePromise; return _pipe!; }
	_loading = true;
	_pipePromise = new Promise<void>((resolve) => {
		_resolveReady = resolve;
	});
	try {
		const { pipeline } = await import('@xenova/transformers');
		_pipe = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
			quantized: true
		})) as unknown as ExtractPipeline;
		_ready = true;
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

export function getArticleText(event: NostrEvent): string {
	const title = event.tags.find(([k]) => k === 'title')?.[1] || '';
	const summary = event.tags.find(([k]) => k === 'summary')?.[1] || '';
	const content = event.content || '';
	const plain = content.replace(/<[^>]+>/g, '').replace(/[#*_~`>|\\-]+/g, ' ').replace(/\n+/g, ' ').trim();
	return [title, summary, plain.slice(0, 2000)].filter(Boolean).join(' ');
}
