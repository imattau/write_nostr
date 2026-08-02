import { PolyGraph, HNSWIndex, ActivationEngine, defineEdges } from '@0xx0lostcause0xx0/polypack';
import { BinaryStoreAdapter } from '@0xx0lostcause0xx0/polypack/persistence/opfs';
import type { PolyNode } from '@0xx0lostcause0xx0/polypack';
import type { NostrEvent } from 'nostr-tools';
import type { NostrProfile } from '$lib/nostr/profiles';
import { extractNostrPubkeys } from '$lib/utils/markdown';

export const TTL = {
	articles: 60 * 60 * 1000,
	followList: 30 * 60 * 1000,
	profiles: 60 * 60 * 1000,
	relayList: 60 * 60 * 1000
} as const;

const MAX_NODES = 2500;
const MAX_TAGGED_EDGES = 6;
const MAX_MENTION_EDGES = 10;

/** Edge types linking event nodes to topics, authors, and mentioned pubkeys. */
export const EDGE = defineEdges({
	TAGGED: 'tagged',
	AUTHORS: 'authors',
	MENTIONS: 'mentions'
});

/** Decayed activation score a node must have to survive TTL pruning. */
export const MIN_ACTIVATION_KEEP = 0.05;

/** Pubkeys whose articles must not accrue activation nor appear in activation rankings. */
let _blockedPubkeys = new Set<string>();

export function setBlockedPubkeys(pubkeys: Iterable<string>): void {
	_blockedPubkeys = new Set(pubkeys);
}

function isBlocked(node: PolyNode): boolean {
	return node.type === 'event' && _blockedPubkeys.has(node.data.pubkey as string);
}

let _graph: PolyGraph | null = null;
let _initPromise: Promise<void> | null = null;
let _engine: ActivationEngine | null = null;

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
				(onChange) => new HNSWIndex(onChange),
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

async function getEngine(): Promise<ActivationEngine> {
	if (_engine) return _engine;
	const graph = await getGraph();
	_engine = new ActivationEngine(graph);
	return _engine;
}

function nodeToEvent(node: PolyNode): NostrEvent {
	return node.data.event as NostrEvent;
}

export async function putEvents(events: NostrEvent[], groupKey: string): Promise<void> {
	if (!isBrowser()) return;
	const graph = await getGraph();
	const now = Date.now();
	for (const event of events) {
		const existing = graph.getNode(event.id);
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
			// addNode replaces the node wholesale — carry activation forward so
			// re-fetches don't wipe learned state.
			activation: existing?.activation,
			insertedAt: now,
			updatedAt: now
		});
		if (event.kind !== 30023) continue;

		const tags = event.tags
			.filter(([k]) => k === 't')
			.map(([, v]) => v?.toLowerCase().trim())
			.filter(Boolean)
			.slice(0, MAX_TAGGED_EDGES);
		for (const tag of tags) {
			const topicId = `t:${tag}`;
			graph.addNode({
				id: topicId,
				type: 'topic',
				data: { tag, cachedAt: now },
				insertedAt: now,
				updatedAt: now
			});
			// Both directions so spreading activation can travel through topic
			// hubs (article -> topic -> sibling article).
			graph.addEdge(event.id, EDGE.TAGGED, topicId, { tag });
			graph.addEdge(topicId, EDGE.TAGGED, event.id, { tag });
		}
		graph.addEdge(event.id, EDGE.AUTHORS, event.pubkey);
		graph.addEdge(event.pubkey, EDGE.AUTHORS, event.id);
		for (const pk of extractNostrPubkeys(event.content).slice(0, MAX_MENTION_EDGES)) {
			graph.addEdge(event.id, EDGE.MENTIONS, pk);
			graph.addEdge(pk, EDGE.MENTIONS, event.id);
		}
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
		} else if (node.type === 'topic') {
			ttl = TTL.articles;
		} else {
			continue;
		}
		// Activated nodes are durable knowledge — don't evict them just
		// because their cache TTL lapsed.
		if (node.type !== 'topic' && graph.getActivation(node.id) >= MIN_ACTIVATION_KEEP) {
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
	// Persist pending writes so the adapter snapshot is authoritative (covers
	// loaded-dirty and evicted-dirty nodes), then enumerate across the store.
	await graph.flush();
	const eventIds = await graph.queryPersisted()
		.whereNodeType('event')
		.whereAttribute('pubkey', pubkey)
		.ids();
	for (const id of eventIds) {
		await graph.removeNodeSafe(id);
	}
	await graph.removeNodeSafe(pubkey);
	// Persist the removals immediately so the purge is durable, not left to the
	// debounced writer.
	await graph.flush();
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

// ── Activation (adaptive memory) ────────────────────────────────

/** Durable reinforcement of a loaded event node. No-op if the node isn't loaded or its author is blocked. */
export async function reinforceEvent(
	id: string,
	amount: number,
	reason?: string
): Promise<void> {
	if (!isBrowser()) return;
	const engine = await getEngine();
	const node = engine.graph.getNode(id);
	if (!node || isBlocked(node)) return;
	engine.reinforce(id, amount, reason);
}

/** Transient, local-only attention — never persisted or synced. Suppressed for blocked authors. */
export async function bumpEventAttention(id: string, amount: number): Promise<void> {
	if (!isBrowser()) return;
	const engine = await getEngine();
	const node = engine.graph.getNode(id);
	if (!node || isBlocked(node)) return;
	engine.bumpAttention(id, amount);
}

/** Durable decayed score plus transient attention for a node. */
export async function effectiveScore(id: string): Promise<number> {
	if (!isBrowser()) return 0;
	const engine = await getEngine();
	return engine.effective(id);
}

/** Loaded article nodes ranked by effective activation descending, excluding blocked authors. */
export async function topActivatedEvents(limit = 50, minScore = 0): Promise<NostrEvent[]> {
	if (!isBrowser()) return [];
	const engine = await getEngine();
	return engine.workingMemory(limit, minScore)
		.filter((n) => n.type === 'event' && n.data.kind === 30023 && !isBlocked(n))
		.map(nodeToEvent);
}

/**
 * Semantic region scoring with reinforcement: nodes whose composite score
 * clears the absorb threshold receive durable reinforcement (blocked authors
 * are never reinforced). Returns `{ nodeId: composite }` ranked descending for
 * the loaded region, minus blocked authors.
 */
export async function absorbSearch(
	text: string,
	options?: { threshold?: number; topK?: number; semanticThreshold?: number }
): Promise<Map<string, number>> {
	if (!isBrowser()) return new Map();
	const engine = await getEngine();
	const scores = await engine.pulse(text, options);
	const entries: { id: string; amount: number; reason: string }[] = [];
	for (const [id, score] of scores) {
		if (score < engine.config.absorbThreshold) continue;
		const node = engine.graph.getNode(id);
		if (!node || isBlocked(node)) {
			scores.delete(id);
			continue;
		}
		entries.push({ id, amount: Math.min(1, engine.config.absorbGain * score), reason: 'pulse' });
	}
	engine.reinforceAll(entries);
	return scores;
}

/** Spreading activation outward from `eventId` across its edges. */
export async function spreadFromEvent(
	eventId: string,
	options?: { depth?: number; decay?: number; edgeTypes?: string[] }
): Promise<Map<string, number>> {
	if (!isBrowser()) return new Map();
	const engine = await getEngine();
	return engine.spread([eventId], options);
}
