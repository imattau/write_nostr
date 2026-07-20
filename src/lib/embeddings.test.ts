import { describe, it, expect } from 'vitest';
import { getArticleText } from './embeddings';

describe('getArticleText', () => {
	it('extracts title and summary from tags with weighting', () => {
		const event = {
			id: 'test1',
			kind: 30023,
			pubkey: 'abc',
			created_at: 1000,
			content: 'Hello world',
			tags: [
				['title', 'My Article'],
				['summary', 'A brief summary']
			]
		} as any;

		const text = getArticleText(event);
		// title weighted 3x, summary weighted 2x
		expect(text).toContain('My Article');
		expect(text).toContain('A brief summary');
		expect(text).toContain('Hello world');
		const words = text.split(/\s+/);
		const titleCount = words.filter(w => w === 'Article').length;
		const summaryCount = words.filter(w => w === 'summary').length;
		expect(titleCount).toBe(3);
		expect(summaryCount).toBe(2);
	});

	it('strips markdown formatting from content', () => {
		const event = {
			id: 'test2',
			kind: 30023,
			pubkey: 'abc',
			created_at: 1000,
			content: '**bold** and *italic* and `code`',
			tags: []
		} as any;

		const text = getArticleText(event);
		expect(text).toContain('bold');
		expect(text).toContain('italic');
		expect(text).toContain('code');
		expect(text).not.toContain('**');
	});

	it('handles missing title gracefully', () => {
		const event = {
			id: 'test3',
			kind: 30023,
			pubkey: 'abc',
			created_at: 1000,
			content: 'Just content',
			tags: []
		} as any;

		const text = getArticleText(event);
		expect(text).toContain('Just content');
		expect(text).not.toContain('Untitled'); // no fallback title
	});

	it('truncates long content to 2000 chars', () => {
		const event = {
			id: 'test4',
			kind: 30023,
			pubkey: 'abc',
			created_at: 1000,
			content: 'A'.repeat(5000),
			tags: []
		} as any;

		const text = getArticleText(event);
		expect(text.length).toBeLessThanOrEqual(2000 + 50); // 2000 + "title summary " overhead
	});

	it('collapses newlines and whitespace', () => {
		const event = {
			id: 'test5',
			kind: 30023,
			pubkey: 'abc',
			created_at: 1000,
			content: 'Line 1\n\n\nLine 2\n  Line 3',
			tags: []
		} as any;

		const text = getArticleText(event);
		expect(text).toContain('Line 1');
		expect(text).toContain('Line 2');
		expect(text).toContain('Line 3');
		expect(text).not.toContain('\n\n');
	});

	it('handles empty content', () => {
		const event = {
			id: 'test6',
			kind: 30023,
			pubkey: 'abc',
			created_at: 1000,
			content: '',
			tags: [['title', 'Only Title']]
		} as any;

		const text = getArticleText(event);
		// title weighted 3x
		expect(text).toBe('Only Title Only Title Only Title');
	});
});
