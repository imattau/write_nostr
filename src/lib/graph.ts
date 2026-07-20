import { PolyGraph, BinaryStoreAdapter, HNSWIndex, VectorIndex } from '@0xx0lostcause0xx0/polypack';
import type { PolyNode } from '@0xx0lostcause0xx0/polypack';
import type { NostrEvent } from 'nostr-tools';
import type { NostrProfile } from '$lib/nostr/profiles';

export const TTL = {
	articles: 60 * 60 * 1000,
	followList: 30 * 60 * 1000,
	profiles: 60 * 60 * 1000,
	relayList: 60 * 60 * 1000
} as const;

const MAX_NODES = 2500;

let _graph: PolyGraph | null = null;
let _initPromise: Promise<void> | null = null;

function isStale(cachedAt: number, ttl: number): boolean {
	return Date.now() - cachedAt > ttl;
}

function isBrowser(): boolean {
	return typeof window !== 'undefined';
}

async function getGraph(): Promise<PolyGraph> {
	if (_graph) return _graph;
	if (!isBrowser()) throw new Error('PolyGraph unavailable server-side');
	if (!_initPromise) {
		_initPromise = (async () => {
			const adapter = new BinaryStoreAdapter({ storeDir: 'write-nostr-poly' });
			_graph = new PolyGraph(
				adapter,
				MAX_NODES,
				undefined,
				undefined,
				(onChange) => new HNSWIndex(onChange) as unknown as VectorIndex,
			);
			try {
				await _graph.warm();
			} catch {
				// first run — no persisted data yet
			}
		})();
	}
	await _initPromise;
	return _graph!;
}

function nodeToEvent(node: PolyNode): NostrEvent {
	return node.data.event as NostrEvent;
}

export async function putEvents(events: NostrEvent[], groupKey: string): Promise<void> {
	if (!isBrowser()) return;
	const graph = await getGraph();
	const now = Date.now();
	for (const event of events) {
		graph.addNode({
			id: event.id,
			type: 'event',
			data: {
				kind: event.kind,
				pubkey: event.pubkey,
				created_at: event.created_at,
				groupKey,
				cachedAt: now,
				event
			},
			insertedAt: now,
			updatedAt: now
		});
	}
}

export async function getEvents(
	groupKey: string,
	ttl: number
): Promise<NostrEvent[] | null> {
	if (!isBrowser()) return null;
	const graph = await getGraph();
	const nodes = graph.query()
		.whereNodeType('event')
		.whereAttribute('groupKey', groupKey)
		.toArray();
	if (!nodes.length) return null;
	const oldestCachedAt = Math.min(...nodes.map((n) => n.data.cachedAt as number));
	if (isStale(oldestCachedAt, ttl)) return null;
	return nodes.map(nodeToEvent);
}

export async function getEvent(id: string, ttl?: number): Promise<NostrEvent | null> {
	if (!isBrowser()) return null;
	const graph = await getGraph();
	const node = graph.getNode(id);
	if (!node) return null;
	if (ttl !== undefined && isStale(node.data.cachedAt as number, ttl)) return null;
	return nodeToEvent(node);
}

export async function getAllEventsByKind(
	kind: number,
	ttl: number
): Promise<NostrEvent[]> {
	if (!isBrowser()) return [];
	const graph = await getGraph();
	const nodes = graph.query()
		.whereNodeType('event')
		.whereAttribute('kind', kind)
		.toArray();
	return nodes
		.filter((n) => !isStale(n.data.cachedAt as number, ttl))
		.map(nodeToEvent);
}

export async function putProfiles(profiles: Map<string, NostrProfile | null>): Promise<void> {
	if (!isBrowser()) return;
	const graph = await getGraph();
	const now = Date.now();
	for (const [pubkey, profile] of profiles) {
		graph.addNode({
			id: pubkey,
			type: 'profile',
			data: { pubkey, profile, cachedAt: now },
			insertedAt: now,
			updatedAt: now
		});
	}
}

export async function getProfiles(
	pubkeys: string[],
	ttl: number = TTL.profiles
): Promise<Map<string, NostrProfile | null>> {
	if (!isBrowser()) return new Map();
	const graph = await getGraph();
	const result = new Map<string, NostrProfile | null>();
	for (const pk of pubkeys) {
		const node = graph.getNode(pk);
		if (node && !isStale(node.data.cachedAt as number, ttl)) {
			result.set(pk, node.data.profile as NostrProfile | null);
		}
	}
	return result;
}

export async function pruneStaleCache(): Promise<void> {
	if (!isBrowser()) return;
	const graph = await getGraph();
	const now = Date.now();
	const toRemove: string[] = [];
	for (const node of graph.query().toArray()) {
		let ttl: number;
		if (node.type === 'profile') {
			ttl = TTL.profiles;
		} else if (node.type === 'event') {
			const gk = node.data.groupKey as string;
			ttl = gk?.startsWith('followlist') ? TTL.followList : TTL.articles;
		} else {
			continue;
		}
		if (now - (node.data.cachedAt as number) > ttl) {
			toRemove.push(node.id);
		}
	}
	for (const id of toRemove) {
		graph.removeNode(id);
	}
}

// ── Cache cleanup ───────────────────────────────────────────────

export async function removeNodesByPubkey(pubkey: string): Promise<void> {
	if (!isBrowser()) return;
	const graph = await getGraph();
	const eventIds = graph.query()
		.whereNodeType('event')
		.whereAttribute('pubkey', pubkey)
		.ids();
	for (const id of eventIds) graph.removeNode(id);
	const profileNode = graph.getNode(pubkey);
	if (profileNode?.type === 'profile') graph.removeNode(pubkey);
}

// ── Vector search ───────────────────────────────────────────────

export async function searchEventsByText(
	text: string,
	threshold?: number,
	topK?: number
): Promise<NostrEvent[]> {
	if (!isBrowser()) return [];
	const graph = await getGraph();
	const q = await graph.queryText(text, threshold, topK);
	return q
		.whereNodeType('event')
		.whereAttribute('kind', 30023)
		.toArray()
		.map(nodeToEvent);
}

export async function indexEventVector(
	eventId: string,
	vector: Float64Array
): Promise<void> {
	if (!isBrowser()) return;
	const graph = await getGraph();
	const node = graph.getNode(eventId);
	if (!node) return;
	graph.updateNode(eventId, {}, vector);
}

export async function searchSimilarEvents(
	vector: number[],
	threshold?: number,
	topK?: number
): Promise<NostrEvent[]> {
	if (!isBrowser()) return [];
	const graph = await getGraph();
	return graph.query()
		.whereNodeType('event')
		.whereAttribute('kind', 30023)
		.similarTo(vector, threshold, topK)
		.toArray()
		.map(nodeToEvent);
}

export async function rankEventsByCentroid(ids: string[]): Promise<string[]> {
	if (!isBrowser() || !ids.length) return ids;
	const graph = await getGraph();
	const vectors: { id: string; vector: Float64Array }[] = [];
	for (const id of ids) {
		const node = graph.getNode(id);
		if (node?.vector) vectors.push({ id, vector: node.vector });
	}
	if (vectors.length < 2) return ids;
	const dims = vectors[0].vector.length;
	const centroid = new Float64Array(dims);
	for (const v of vectors) {
		for (let d = 0; d < dims; d++) centroid[d] += v.vector[d];
	}
	for (let d = 0; d < dims; d++) centroid[d] /= vectors.length;
	const scores = vectors.map((v) => {
		let dot = 0, na = 0, nb = 0;
		for (let d = 0; d < dims; d++) {
			dot += v.vector[d] * centroid[d];
			na += v.vector[d] * v.vector[d];
			nb += centroid[d] * centroid[d];
		}
		return { id: v.id, score: dot / (Math.sqrt(na) * Math.sqrt(nb) || 1) };
	});
	scores.sort((a, b) => b.score - a.score);
	const ranked = scores.map((s) => s.id);
	const missing = ids.filter((id) => !vectors.some((v) => v.id === id));
	return [...ranked, ...missing];
}

export async function findRelatedEvents(
	eventId: string,
	threshold?: number,
	topK?: number
): Promise<NostrEvent[]> {
	if (!isBrowser()) return [];
	const graph = await getGraph();
	const node = graph.getNode(eventId);
	if (!node?.vector) return [];
	return graph.query()
		.whereNodeType('event')
		.whereAttribute('kind', 30023)
		.similarTo(Array.from(node.vector), threshold, (topK ?? 6) + 1)
		.toArray()
		.filter((n) => n.id !== eventId)
		.slice(0, topK ?? 6)
		.map(nodeToEvent);
}
