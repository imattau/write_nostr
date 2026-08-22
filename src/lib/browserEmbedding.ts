import {
	getEmbeddingProvider,
	reindexPersistedArticleEmbeddings,
	setEmbeddingProvider,
	type EmbeddingProvider
} from '$lib/embeddings';

export const DEFAULT_BROWSER_EMBEDDING_MODEL = 'onnx-community/all-MiniLM-L6-v2-ONNX';

interface PendingRequest {
	resolve: (vector: Float64Array) => void;
	reject: (error: Error) => void;
}

export interface BrowserEmbeddingOptions {
	model?: string;
	device?: 'wasm' | 'webgpu';
}

function createBrowserEmbeddingProvider(options: BrowserEmbeddingOptions = {}): EmbeddingProvider {
	if (typeof Worker === 'undefined') throw new Error('Embedding Worker is unavailable.');
	const model = options.model ?? DEFAULT_BROWSER_EMBEDDING_MODEL;
	const device = options.device ?? (typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm');
	const worker = new Worker(new URL('./embedding.worker.ts', import.meta.url), { type: 'module' });
	let nextId = 0;
	const pending = new Map<number, PendingRequest>();

	worker.onmessage = ({ data }: MessageEvent<{ id: number; vector?: number[]; error?: string }>) => {
		const request = pending.get(data.id);
		if (!request) return;
		pending.delete(data.id);
		if (data.error || !data.vector) {
			request.reject(new Error(data.error ?? 'Browser embedding returned no vector.'));
			return;
		}
		request.resolve(new Float64Array(data.vector));
	};
	worker.onerror = (event) => {
		const error = new Error(event.message || 'Embedding Worker failed.');
		for (const request of pending.values()) request.reject(error);
		pending.clear();
	};

	return {
		version: `transformers:${model}:${device}`,
		dimensions: 384,
		embed(text) {
			return new Promise<Float64Array>((resolve, reject) => {
				const id = nextId++;
				pending.set(id, { resolve, reject });
				worker.postMessage({ id, text, model, device });
			});
		}
	};
}

/** Warm Transformers.js away from the UI path, then rebuild persisted vectors. */
export async function enableBrowserSemanticEmbeddings(options: BrowserEmbeddingOptions = {}): Promise<boolean> {
	const devices: Array<BrowserEmbeddingOptions['device']> = options.device
		? [options.device]
		: typeof navigator !== 'undefined' && 'gpu' in navigator
			? ['webgpu', 'wasm']
			: ['wasm'];
	let lastError: unknown;

	for (const device of devices) {
		try {
			const provider = createBrowserEmbeddingProvider({ ...options, device });
			const warmup = await provider.embed('semantic search warmup');
			if (warmup.length !== getEmbeddingProvider().dimensions) {
				throw new RangeError(`Embedding model returned ${warmup.length} dimensions; expected 384.`);
			}
			setEmbeddingProvider(provider);
			await reindexPersistedArticleEmbeddings();
			console.info(`Browser semantic embeddings enabled with ${device}.`);
			return true;
		} catch (error) {
			lastError = error;
			console.warn(`Browser semantic embeddings ${device} unavailable; trying fallback.`, error);
		}
	}

	console.warn('Browser semantic embeddings unavailable; retaining FeatureHashEmbedding.', lastError);
	return false;
}
