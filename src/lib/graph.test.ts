import { describe, it, expect, beforeAll } from 'vitest';
import { PolyGraph, MemoryAdapter } from '@0xx0lostcause0xx0/polypack';

function makeEvent(id: number, kind = 30023) {
	return {
		id: `ev-${id}`,
		kind,
		pubkey: `pk-${id % 10}`,
		created_at: Date.now() / 1000 - id,
		content: `Article ${id} content about ${id % 2 === 0 ? 'bitcoin' : 'nostr'}`,
		tags: [['t', id % 2 === 0 ? 'bitcoin' : 'nostr'], ['title', `Article ${id}`]]
	};
}

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe('PolyGraph vector search', () => {
	let graph: PolyGraph;
	const DIMS = 8;

	beforeAll(() => {
		graph = new PolyGraph(new MemoryAdapter(), 1000);
		const now = Date.now();

		for (let i = 0; i < 50; i++) {
			// Create vectors with clustering: even IDs point toward [1,1,1...],
			// odd IDs point toward [-1,-1,-1...], to make similarity predictable
			const vec = new Float64Array(DIMS);
			const bias = i % 2 === 0 ? 1 : -1;
			for (let d = 0; d < DIMS; d++) {
				vec[d] = bias * (0.5 + Math.random() * 0.5);
			}
			const ev = makeEvent(i);
			graph.addNode({
				id: ev.id,
				type: 'event',
				data: {
					kind: ev.kind,
					groupKey: 'articles-all',
					cachedAt: now,
					event: ev
				},
				vector: vec,
				insertedAt: now,
				updatedAt: now
			});
		}
	});

	it('finds similar events by vector', () => {
		const queryVec = new Array(DIMS).fill(1);
		const results = graph.query()
			.whereNodeType('event')
			.whereAttribute('kind', 30023)
			.similarTo(queryVec, 0.0, 5)
			.toArray();

		expect(results).toHaveLength(5);
		// Top results should be even-numbered events (biased toward [1,1,1...])
		for (const r of results) {
			const score = cosineSimilarity(queryVec, Array.from(r.vector!));
			expect(score).toBeGreaterThan(0.5);
		}
	});

	it('respects kind filter combined with similarity', () => {
		// Add some non-article events
		graph.addNode({
			id: 'ev-other',
			type: 'event',
			data: { kind: 1, groupKey: 'text-notes', cachedAt: Date.now(), event: { id: 'ev-other', kind: 1 } },
			vector: new Float64Array(DIMS).fill(1),
			insertedAt: Date.now(),
			updatedAt: Date.now()
		});

		const queryVec = new Array(DIMS).fill(1);
		const results = graph.query()
			.whereNodeType('event')
			.whereAttribute('kind', 30023)
			.similarTo(queryVec, 0.0, 50)
			.toArray();

		for (const r of results) {
			expect(r.data.kind).toBe(30023);
		}
	});

	it('returns empty for impossible threshold', () => {
		const queryVec = new Array(DIMS).fill(1);
		const results = graph.query()
			.whereNodeType('event')
			.whereAttribute('kind', 30023)
			.similarTo(queryVec, 1.5, 5) // cosine similarity cannot exceed 1.0
			.toArray();
		expect(results).toHaveLength(0);
	});

	it('finds related events to a specific event', () => {
		const source = graph.getNode('ev-0');
		expect(source).toBeDefined();
		expect(source!.vector).toBeDefined();

		const related = graph.query()
			.whereNodeType('event')
			.whereAttribute('kind', 30023)
			.similarTo(Array.from(source!.vector!), 0.0, 6)
			.toArray()
			.filter(n => n.id !== 'ev-0');

		expect(related.length).toBeGreaterThanOrEqual(1);
		expect(related.length).toBeLessThanOrEqual(5);
		// Related should be even-numbered events (same cluster as ev-0)
		for (const r of related) {
			const id = parseInt(r.id.split('-')[1]);
			expect(id % 2).toBe(0);
		}
	});

	it('updates node vector via updateNode', () => {
		const newVec = new Float64Array(DIMS);
		newVec[0] = 1;
		graph.updateNode('ev-0', {}, newVec);

		const node = graph.getNode('ev-0');
		expect(node!.vector).toEqual(newVec);

		// Query for the new vector should return ev-0 as top result
		const results = graph.query()
			.whereNodeType('event')
			.similarTo(Array.from(newVec), 0.0, 3)
			.toArray();
		expect(results[0].id).toBe('ev-0');
	});
});
