/**
 * Simple LRU (Least Recently Used) Map with a max size constraint.
 * Automatically evicts the least recently accessed entry when the limit is reached.
 */
export class LRUMap<K, V> {
	private data: Map<K, { value: V; prev: K | null; next: K | null }>;
	private head: K | null = null;
	private tail: K | null = null;
	private max: number;

	constructor(max: number) {
		this.max = max;
		this.data = new Map();
	}

	get size(): number {
		return this.data.size;
	}

	has(key: K): boolean {
		return this.data.has(key);
	}

	get(key: K): V | undefined {
		const node = this.data.get(key);
		if (!node) return undefined;
		this.moveToHead(key, node);
		return node.value;
	}

	set(key: K, value: V): void {
		if (this.data.has(key)) {
			const node = this.data.get(key)!;
			node.value = value;
			this.moveToHead(key, node);
			return;
		}

		const node = { value, prev: null, next: null };
		this.data.set(key, node);
		this.addToHead(key);

		if (this.data.size > this.max) {
			this.evictTail();
		}
	}

	delete(key: K): boolean {
		const node = this.data.get(key);
		if (!node) return false;
		this.removeNode(key, node);
		return this.data.delete(key);
	}

	entries(): IterableIterator<[K, V]> {
		const result: [K, V][] = [];
		let curr = this.head;
		while (curr !== null) {
			const node = this.data.get(curr)!;
			result.push([curr, node.value]);
			curr = node.next;
		}
		return result[Symbol.iterator]();
	}

	forEach(fn: (value: V, key: K) => void): void {
		let curr = this.head;
		while (curr !== null) {
			const node = this.data.get(curr)!;
			fn(node.value, curr);
			curr = node.next;
		}
	}

	[Symbol.iterator](): IterableIterator<[K, V]> {
		return this.entries();
	}

	keys(): IterableIterator<K> {
		return this.data.keys();
	}

	values(): IterableIterator<V> {
		const result: V[] = [];
		let curr = this.head;
		while (curr !== null) {
			result.push(this.data.get(curr)!.value);
			curr = this.data.get(curr)!.next;
		}
		return result[Symbol.iterator]();
	}

	private addToHead(key: K): void {
		if (this.head === null) {
			this.head = key;
			this.tail = key;
		} else {
			const oldHead = this.data.get(this.head)!;
			oldHead.prev = key;
			const node = this.data.get(key)!;
			node.next = this.head;
			node.prev = null;
			this.head = key;
		}
	}

	private removeNode(key: K, node: { value: V; prev: K | null; next: K | null }): void {
		if (node.prev !== null) {
			this.data.get(node.prev)!.next = node.next;
		} else {
			this.head = node.next;
		}

		if (node.next !== null) {
			this.data.get(node.next)!.prev = node.prev;
		} else {
			this.tail = node.prev;
		}
	}

	private moveToHead(key: K, node: { value: V; prev: K | null; next: K | null }): void {
		if (key === this.head) return;
		this.removeNode(key, node);
		this.addToHead(key);
	}

	private evictTail(): void {
		if (this.tail === null) return;
		const tailKey = this.tail;
		const tailNode = this.data.get(tailKey)!;

		if (tailNode.prev !== null) {
			this.data.get(tailNode.prev)!.next = null;
		} else {
			this.head = null;
		}
		this.tail = tailNode.prev;
		this.data.delete(tailKey);
	}
}
