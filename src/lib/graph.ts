import { PolyGraph, IndexedDBAdapter } from '@0xx0lostcause0xx0/polypack';
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
			const adapter = new IndexedDBAdapter({ name: 'write-nostr-poly', version: 1 });
			_graph = new PolyGraph(adapter, MAX_NODES);
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

// ── Vector search ───────────────────────────────────────────────

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
