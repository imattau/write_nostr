<script lang="ts">
	import { generateAIDraft, type AIDraftAction, type AIDraftingSettings } from '$lib/ai-drafting';

	let { settings, title, content, selectedText, onApply, onClose } = $props<{
		settings: AIDraftingSettings;
		title: string;
		content: string;
		selectedText: string;
		onApply: (markdown: string, scoped: boolean, action: AIDraftAction) => void;
		onClose: () => void;
	}>();
	let action = $state<AIDraftAction>('draft');
	let prompt = $state('');
	let result = $state('');
	let error = $state('');
	let loading = $state(false);
	let scoped = $derived(Boolean(selectedText));
	$effect(() => { if (selectedText && action === 'draft') action = 'rewrite'; });

	const actions: Array<{ value: AIDraftAction; label: string }> = [
		{ value: 'draft', label: 'Draft' }, { value: 'rewrite', label: 'Rewrite' },
		{ value: 'concise', label: 'Concise' }, { value: 'expand', label: 'Expand' }, { value: 'summary', label: 'Summary' }
	];

	async function generate() {
		loading = true; error = ''; result = '';
		try {
			const response = await generateAIDraft({ ...settings, action, prompt: prompt.trim() || 'Improve this writing.', currentMarkdown: scoped ? selectedText : content, currentTitle: title, sectionScoped: scoped });
			result = response.markdown;
		} catch (e) { error = e instanceof Error ? e.message : 'AI request failed.'; }
		finally { loading = false; }
	}
</script>

<aside class="ai-panel" aria-label="AI writing assistant">
	<div class="panel-header"><h2>AI assistant</h2><button aria-label="Close AI assistant" onclick={onClose}>×</button></div>
	<p class="hint">{scoped ? 'Working on the selected text.' : 'Working on the current draft.'}</p>
	<select bind:value={action} aria-label="AI action">
		{#each actions as item}<option value={item.value}>{item.label}</option>{/each}
	</select>
	<textarea bind:value={prompt} placeholder={action === 'draft' ? 'What would you like to write?' : 'Optional instructions...'} rows="3"></textarea>
	<button class="primary generate" onclick={generate} disabled={loading}>{loading ? 'Generating…' : 'Generate'}</button>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if result}
		<div class="result-label">Generated result</div>
		<div class="result">{result}</div>
		<div class="result-actions"><button onclick={() => onApply(result, scoped, action)}>Apply</button><button onclick={() => (result = '')}>Discard</button></div>
	{/if}
	<p class="privacy">Your draft is sent directly to the selected AI provider. Configure the provider and key in Settings.</p>
</aside>

<style>
	.ai-panel { position: fixed; z-index: 20; top: 48px; right: 0; bottom: 0; width: min(360px, 92vw); padding: var(--space-md); background: var(--c-surface); border-left: 1px solid var(--c-border); box-shadow: -8px 0 24px rgba(0,0,0,.12); overflow-y: auto; }
	.panel-header { display: flex; align-items: center; justify-content: space-between; } h2 { font-size: 1rem; }
	.panel-header button { border: 0; font-size: 1.5rem; padding: 0 6px; } .hint, .privacy, .result-label { color: var(--c-text-secondary); font-size: .8rem; }
	select, textarea { width: 100%; margin-top: var(--space-sm); } textarea { resize: vertical; }
	.generate { width: 100%; margin-top: var(--space-sm); } .error { color: var(--c-danger); font-size: .85rem; }
	.result-label { margin-top: var(--space-lg); } .result { white-space: pre-wrap; max-height: 360px; overflow: auto; padding: var(--space-sm); margin-top: var(--space-xs); background: var(--c-bg); border: 1px solid var(--c-border); border-radius: var(--radius); font-size: .9rem; }
	.result-actions { display: flex; gap: var(--space-sm); margin-top: var(--space-sm); } .privacy { margin-top: var(--space-xl); line-height: 1.5; }
</style>
