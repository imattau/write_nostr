import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateAIDraft } from './ai-drafting';

afterEach(() => vi.restoreAllMocks());

describe('generateAIDraft', () => {
	it('sends a Habla-style scoped rewrite request', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Rewritten section' } }] }), { status: 200 }));
		const result = await generateAIDraft({ provider: 'openai', apiKey: 'key', model: 'model', action: 'rewrite', prompt: 'Improve this', currentMarkdown: 'Old text', sectionScoped: true });
		expect(result.markdown).toBe('Rewritten section');
		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(body.messages[0].content).toContain('only the provided section');
		expect(body.messages[1].content).toContain('Old text');
	});

	it('surfaces provider errors and empty responses', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Bad key' } }), { status: 401 }));
		await expect(generateAIDraft({ provider: 'groq', apiKey: 'key', model: 'model', action: 'draft', prompt: 'Write' })).rejects.toThrow('Bad key');
		vi.restoreAllMocks();
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }));
		await expect(generateAIDraft({ provider: 'groq', apiKey: 'key', model: 'model', action: 'draft', prompt: 'Write' })).rejects.toThrow('no draft content');
	});
});
