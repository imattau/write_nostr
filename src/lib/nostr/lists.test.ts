import { describe, it, expect, vi, afterEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, SimplePool } from 'nostr-tools';
import { loadList, tagsToEntries, entriesToTags } from './lists';

const localValues = new Map<string, string>();

afterEach(() => {
	localValues.clear();
	vi.unstubAllGlobals();
});

describe('loadList cache', () => {
	it('uses a verified local list when relay data is unavailable', async () => {
		vi.spyOn(SimplePool.prototype, 'querySync').mockResolvedValue([]);
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => localValues.get(key) ?? null,
			setItem: (key: string, value: string) => localValues.set(key, value)
		});
		const secretKey = generateSecretKey();
		const pubkey = getPublicKey(secretKey);
		const event = finalizeEvent({
			kind: 10000,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['p', 'a'.repeat(64)]],
			content: ''
		}, secretKey);
		localValues.set(`write_nip51_${pubkey}_10000_`, JSON.stringify(event));
		const signer = { type: 'nsec' as const, pubkey, sign: async () => event };
		await expect(loadList(signer, [], { kind: 10000 })).resolves.toEqual([
			{ tag: ['p', 'a'.repeat(64)], private: false }
		]);
	});
});

describe('tagsToEntries', () => {
	it('marks public tags as not private and private tags as private, public first', () => {
		const result = tagsToEntries([['p', 'a']], [['p', 'b']]);
		expect(result).toEqual([
			{ tag: ['p', 'a'], private: false },
			{ tag: ['p', 'b'], private: true }
		]);
	});

	it('handles empty inputs', () => {
		expect(tagsToEntries([], [])).toEqual([]);
	});
});

describe('entriesToTags', () => {
	it('splits entries by privacy', () => {
		const entries = [
			{ tag: ['p', 'a'], private: false },
			{ tag: ['p', 'b'], private: true }
		];
		expect(entriesToTags(entries)).toEqual({
			publicTags: [['p', 'a']],
			privateTags: [['p', 'b']]
		});
	});

	it('prepends a d tag to the public tags when dTag is given', () => {
		const entries = [{ tag: ['p', 'a'], private: false }];
		expect(entriesToTags(entries, 'friends')).toEqual({
			publicTags: [['d', 'friends'], ['p', 'a']],
			privateTags: []
		});
	});

	it('omits the d tag when dTag is undefined', () => {
		const entries = [{ tag: ['p', 'a'], private: false }];
		expect(entriesToTags(entries)).toEqual({
			publicTags: [['p', 'a']],
			privateTags: []
		});
	});
});
