import { describe, it, expect, beforeAll } from 'vitest';
import { PolyGraph, MemoryAdapter, ActivationEngine, FeatureHashEmbedding, defineEdges } from '@0xx0lostcause0xx0/polypack';

const EDGE = defineEdges({ TAGGED: 'tagged', AUTHORS: 'authors', MENTIONS: 'mentions' });
const embedding = new FeatureHashEmbedding({ dimensions: 384 });

const MIN_ACTIVATION_KEEP = 0.05;
const TTL_ARTICLES = 60 * 60 * 1000;

function makeEvent(id: string, content: string, tags: string[] = []) {
	return {
		id,
		kind: 30023,
		pubkey: `pk-${id}`,
		created_at: Math.floor(Date.now() / 1000),
		content,
		tags: [...tags.map((t) => ['t', t]), ['title', `Article ${id}`]]
	};
}

describe('activation preservation across re-add', () => {
	let graph: PolyGraph;

	beforeAll(() => {
		graph = new PolyGraph(new MemoryAdapter(), 1000);
	});

	it('addNode without activation wipes prior activation', () => {
		const id = 'ev-wipe';
		graph.addNode({ id, type: 'event', data: { event: {} }, insertedAt: Date.now(), updatedAt: Date.now() });
		graph.reinforceNode(id, 1.0, 'read');
		expect(graph.getActivation(id)).toBeGreaterThan(0);

		// Re-fetch that doesn't carry activation forward (the bug we guard against)
		graph.addNode({ id, type: 'event', data: { event: {} }, insertedAt: Date.now(), updatedAt: Date.now() });
		expect(graph.getActivation(id)).toBe(0);
	});

	it('carrying activation forward preserves it', () => {
		const id = 'ev-keep';
		graph.addNode({ id, type: 'event', data: { event: {} }, insertedAt: Date.now(), updatedAt: Date.now() });
		graph.reinforceNode(id, 1.0, 'read');
		const existing = graph.getNode(id);

		// putEvents pattern: spread existing?.activation into the replacement
		graph.addNode({
			id,
			type: 'event',
			data: { event: {} },
			activation: existing?.activation,
			insertedAt: Date.now(),
			updatedAt: Date.now()
		});
		expect(graph.getActivation(id)).toBeGreaterThan(0);
	});
});

describe('durable reinforcement ranking', () => {
	let graph: PolyGraph;

	beforeAll(() => {
		graph = new PolyGraph(new MemoryAdapter(), 1000);
		const now = Date.now();
		graph.addNode({ id: 'ev-a', type: 'event', data: { kind: 30023, event: {} }, insertedAt: now, updatedAt: now });
		graph.addNode({ id: 'ev-b', type: 'event', data: { kind: 30023, event: {} }, insertedAt: now, updatedAt: now });
		graph.addNode({ id: 'ev-c', type: 'event', data: { kind: 30023, event: {} }, insertedAt: now, updatedAt: now });
		graph.reinforceNode('ev-a', 1.0, 'like');
		graph.reinforceNode('ev-b', 0.5, 'read');
	});

	it('topActivated ranks reinforced nodes descending', () => {
		const top = graph.topActivated(10);
		expect(top[0].id).toBe('ev-a');
		expect(top[1].id).toBe('ev-b');
	});

	it('getActivation returns 0 for unreinforced nodes', () => {
		expect(graph.getActivation('ev-c')).toBe(0);
	});
});

describe('prune logic keeps activated nodes', () => {
	it('removes only stale, unactivated nodes', () => {
		const graph = new PolyGraph(new MemoryAdapter(), 1000);
		const stale = Date.now() - 2 * TTL_ARTICLES;
		graph.addNode({
			id: 'ev-stale-active',
			type: 'event',
			data: { cachedAt: stale, groupKey: 'articles-all', event: {} },
			insertedAt: stale,
			updatedAt: stale
		});
		graph.addNode({
			id: 'ev-stale-inactive',
			type: 'event',
			data: { cachedAt: stale, groupKey: 'articles-all', event: {} },
			insertedAt: stale,
			updatedAt: stale
		});
		graph.reinforceNode('ev-stale-active', 1.0, 'read');

		const now = Date.now();
		const toRemove: string[] = [];
		for (const node of graph.query().toArray()) {
			if (node.type !== 'event') continue;
			if (graph.getActivation(node.id) >= MIN_ACTIVATION_KEEP) continue;
			if (now - (node.data.cachedAt as number) > TTL_ARTICLES) toRemove.push(node.id);
		}

		expect(toRemove).toEqual(['ev-stale-inactive']);
	});
});

describe('absorb and spread over topic edges', () => {
	let graph: PolyGraph;
	let engine: ActivationEngine;

	beforeAll(async () => {
		graph = new PolyGraph(new MemoryAdapter(), 1000, embedding);
		engine = new ActivationEngine(graph);
		const now = Date.now();
		const articles = [
			{ id: 'ev-1', content: 'bitcoin lightning payments explained simply', tags: ['bitcoin'] },
			{ id: 'ev-2', content: 'lightning wallets and channel routing details', tags: ['bitcoin'] },
			{ id: 'ev-3', content: 'cooking fresh pasta recipes at home', tags: ['food'] }
		];
		for (const a of articles) {
			const ev = makeEvent(a.id, a.content, a.tags);
			graph.addNode({ id: ev.id, type: 'event', data: { kind: 30023, event: ev }, insertedAt: now, updatedAt: now });
			const vector = await graph.embed(a.content);
			graph.updateNode(ev.id, {}, vector);
			for (const t of a.tags) {
				const topicId = `t:${t}`;
				graph.addNode({ id: topicId, type: 'topic', data: { tag: t }, insertedAt: now, updatedAt: now });
				graph.addEdge(ev.id, EDGE.TAGGED, topicId, { tag: t });
				graph.addEdge(topicId, EDGE.TAGGED, ev.id, { tag: t });
			}
		}
	});

	it('absorb scores the semantic region and durably reinforces it', async () => {
		const scores = await engine.absorb('bitcoin and lightning');
		const bitcoinIds = ['ev-1', 'ev-2'];
		expect(bitcoinIds.every((id) => scores.has(id))).toBe(true);
		expect((scores.get('ev-1') ?? 0)).toBeGreaterThan(scores.get('ev-3') ?? 0);
		// Durable reinforcement applied above the absorb threshold
		expect(graph.getActivation('ev-1')).toBeGreaterThan(0);
		expect(graph.getActivation('ev-2')).toBeGreaterThan(0);
	});

	it('spread travels across topic edges', () => {
		const contrib = engine.spread(['ev-1'], { depth: 2, edgeTypes: [EDGE.TAGGED] });
		// ev-1 -> t:bitcoin -> ev-2
		expect((contrib.get('ev-2') ?? 0)).toBeGreaterThan(0);
	});
});
