import { describe, it, expect } from 'vitest';
import { ActivationEngine, MemoryAdapter, PolyGraph } from '@0xx0lostcause0xx0/polypack';

function node(id: string, kind = 30023) {
	const now = Date.now();
	return {
		id,
		type: 'event',
		data: { kind, cachedAt: now, event: { id, kind } },
		insertedAt: now,
		updatedAt: now
	};
}

describe('Polypack 3.1 integration contracts', () => {
	it('persists schemas/indexes and ranks persisted activation', async () => {
		const graph = new PolyGraph(new MemoryAdapter(), 2);
		graph.registerNodeType('event', { requiredFields: ['kind', 'event'], memoryClass: 'episodic' });
		graph.defineIndex({ name: 'event-kind', nodeType: 'event', fields: ['kind'] });
		graph.addNode(node('cold'));
		graph.addNode(node('hot'));
		graph.reinforceNode('hot', 1, 'read');
		await graph.flush();

		const ranked = await graph.queryPersisted()
			.whereNodeType('event')
			.orderByActivation('desc')
			.toArray();

		expect(ranked[0].id).toBe('hot');
		expect(graph.nodeTypes.get('event')?.memoryClass).toBe('episodic');
		expect(graph.indexes.map((index) => index.name)).toContain('event-kind');
	});

	it('rolls back a failed transaction', async () => {
		const graph = new PolyGraph(new MemoryAdapter());
		await expect(
			graph.transaction((tx) => {
				tx.addNode(node('rolled-back'));
				throw new Error('abort');
			})
		).rejects.toThrow('abort');

		expect(graph.getNode('rolled-back')).toBeUndefined();
	});

	it('supports context activation, inhibition, and budgeted working memory', () => {
		const graph = new PolyGraph(new MemoryAdapter());
		graph.addNode(node('article-a'));
		graph.addNode(node('article-b'));
		const engine = new ActivationEngine(graph);

		engine.reinforce('article-a', 1, 'read', 'circle');
		engine.reinforce('article-b', 1, 'read', 'writing');
		graph.suppressNode('article-b', 0.5, 'not-interested');

		expect(graph.getContextActivation('article-a', 'circle')).toBeGreaterThan(0);
		expect(graph.getContextActivation('article-a', 'writing')).toBe(0);
		expect(engine.effective('article-b')).toBeLessThan(engine.effective('article-a'));

		const selected = engine.workingMemory({
			limit: 2,
			tokenBudget: 1,
			costOf: () => 1
		});
		expect(selected).toHaveLength(1);
	});
});
