import { describe, it, expect } from 'vitest';
import { tagsToEntries, entriesToTags } from './lists';

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
