export type AIProvider = 'openai' | 'groq';
export type AIDraftAction = 'draft' | 'rewrite' | 'concise' | 'expand' | 'summary';

export type AIDraftingSettings = {
	provider: AIProvider;
	apiKey: string;
	model: string;
};

export type GenerateDraftInput = AIDraftingSettings & {
	action: AIDraftAction;
	prompt: string;
	currentMarkdown?: string;
	currentTitle?: string;
	sectionScoped?: boolean;
};

export type GenerateDraftResult = { markdown: string; provider: AIProvider; model: string };

export type AvailableModel = { id: string; name: string };

export const DEFAULT_MODELS: Record<AIProvider, string> = {
	openai: 'gpt-4.1-mini',
	groq: 'llama-3.3-70b-versatile'
};

export const PROVIDER_LABELS: Record<AIProvider, string> = { openai: 'OpenAI', groq: 'Groq' };

const endpoints: Record<AIProvider, string> = {
	openai: 'https://api.openai.com/v1/chat/completions',
	groq: 'https://api.groq.com/openai/v1/chat/completions'
};

const modelEndpoints: Record<AIProvider, string> = {
	openai: 'https://api.openai.com/v1/models',
	groq: 'https://api.groq.com/openai/v1/models'
};

// The providers expose non-chat models from the same endpoint (embeddings,
// speech, moderation, etc.). Keep the selector focused on likely chat models.
function isChatModel(provider: AIProvider, id: string): boolean {
	const normalized = id.toLowerCase();
	if (provider === 'openai') {
		return normalized.startsWith('gpt-') || normalized.startsWith('o1') || normalized.startsWith('o3') || normalized.startsWith('o4') || normalized.startsWith('chatgpt-') || normalized.startsWith('ft:gpt-');
	}
	return !['whisper', 'distil-whisper', 'guard', 'tts', 'orpheus'].some((part) => normalized.includes(part));
}

export async function listAvailableModels(provider: AIProvider, apiKey: string): Promise<AvailableModel[]> {
	if (!apiKey.trim()) throw new Error(`Add an ${PROVIDER_LABELS[provider]} API key first.`);
	const response = await fetch(modelEndpoints[provider], {
		headers: { Authorization: `Bearer ${apiKey}` }
	});
	const payload = await response.json().catch(() => null) as any;
	if (!response.ok) throw new Error(payload?.error?.message || `Could not fetch models (status ${response.status})`);
	const models = Array.isArray(payload?.data) ? payload.data : [];
	return models
		.filter((model: any) => typeof model?.id === 'string' && model.id && model.active !== false && isChatModel(provider, model.id))
		.map((model: any) => ({ id: model.id, name: model.id }))
		.sort((a: AvailableModel, b: AvailableModel) => a.id.localeCompare(b.id));
}

function instruction(action: AIDraftAction): string {
	return {
		draft: 'Write a fresh article draft from the user request.',
		rewrite: 'Rewrite the provided text while preserving its meaning and voice.',
		concise: 'Make the provided text more concise without losing important meaning.',
		expand: 'Expand the provided text with useful detail, examples, and clearer transitions.',
		summary: 'Write a short, accurate summary of the provided article.'
	}[action];
}

function buildPrompts(input: GenerateDraftInput): { system: string; user: string } {
	const scoped = Boolean(input.sectionScoped);
	const summary = input.action === 'summary';
	const system = [
		'You are an expert article drafting assistant for a long-form publishing app.',
		instruction(input.action),
		summary ? 'Return only plain text.' : 'Return only Markdown, without code fences or commentary.',
		scoped ? 'Rewrite only the provided section and do not add a title or preamble.' :
			summary ? 'Keep the summary concise and grounded in the source.' : 'Return a complete article with a clear structure.'
	].join(' ');
	const parts = [`Writer request:\n${input.prompt.trim()}`];
	if (input.currentMarkdown?.trim()) parts.push(`Source markdown:\n${input.currentMarkdown.trim()}`);
	if (input.currentTitle?.trim()) parts.push(`Current title:\n${input.currentTitle.trim()}`);
	parts.push(summary ? 'Output one short summary paragraph.' : scoped ? 'Output only the replacement section.' : 'Output the polished article.');
	return { system, user: parts.join('\n\n') };
}

export function getDefaultAIDraftingSettings(provider: AIProvider = 'openai'): AIDraftingSettings {
	return { provider, apiKey: '', model: DEFAULT_MODELS[provider] };
}

export function loadAIDraftingSettings(pubkey: string | null): AIDraftingSettings {
	if (typeof localStorage === 'undefined' || !pubkey) return getDefaultAIDraftingSettings();
	try {
		const parsed = JSON.parse(localStorage.getItem(`write_ai_drafting_${pubkey}`) || 'null');
		const provider = parsed?.provider === 'groq' ? 'groq' : 'openai';
		return { provider, apiKey: String(parsed?.apiKey || ''), model: String(parsed?.model || DEFAULT_MODELS[provider]) };
	} catch {
		return getDefaultAIDraftingSettings();
	}
}

export function saveAIDraftingSettings(pubkey: string | null, settings: AIDraftingSettings): void {
	if (typeof localStorage === 'undefined' || !pubkey) return;
	localStorage.setItem(`write_ai_drafting_${pubkey}`, JSON.stringify(settings));
}

export async function generateAIDraft(input: GenerateDraftInput): Promise<GenerateDraftResult> {
	if (!input.apiKey.trim()) throw new Error(`Add an ${PROVIDER_LABELS[input.provider]} API key in Settings first.`);
	const prompts = buildPrompts(input);
	const response = await fetch(endpoints[input.provider], {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
		body: JSON.stringify({
			model: input.model,
			temperature: input.action === 'summary' ? 0.3 : 0.7,
			max_tokens: input.action === 'summary' ? 160 : 1200,
			messages: [{ role: 'system', content: prompts.system }, { role: 'user', content: prompts.user }]
		})
	});
	const payload = await response.json().catch(() => null) as any;
	if (!response.ok) throw new Error(payload?.error?.message || `AI request failed with status ${response.status}`);
	const markdown = payload?.choices?.[0]?.message?.content?.trim();
	if (!markdown) throw new Error('AI provider returned no draft content.');
	return { markdown, provider: input.provider, model: input.model };
}
