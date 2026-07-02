<script lang="ts">
	import { onMount } from 'svelte';
	import {
		isTranslationApiAvailable,
		canTranslate,
		translateMarkdown,
		translateTexts,
		resolveArticleLang,
		getBrowserLang
	} from '$lib/utils/translate';
	import { renderMarkdown } from '$lib/utils/markdown';
	import type { NostrEvent } from 'nostr-tools';

	let {
		event,
		onTranslated
	}: {
		event: NostrEvent;
		onTranslated: (data: {
			title: string;
			summary: string;
			contentHtml: string;
			targetLang: string;
		} | null) => void;
	} = $props();

	type ButtonStatus = 'idle' | 'checking' | 'translating' | 'translated' | 'unsupported' | 'error';

	let status = $state<ButtonStatus>('idle');
	let errorMsg = $state('');
	let targetLang = $state(getBrowserLang());
	// sourceLang is resolved asynchronously; null while detecting
	let sourceLang = $state<string | null>(null);

	// Only show the button once we know the source language and it differs from target
	let shouldOffer = $derived(sourceLang !== null && sourceLang !== targetLang);

	onMount(async () => {
		// Detect the real article language: Chrome AI → NIP-23 lang tag → 'en'
		sourceLang = await resolveArticleLang(event.content, event.tags);
	});

	// Readable language name via Intl
	function langName(code: string): string {
		try {
			return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(code) ?? code;
		} catch {
			return code;
		}
	}

	async function handleTranslate() {
		if (!isTranslationApiAvailable()) {
			status = 'unsupported';
			return;
		}

		status = 'checking';
		errorMsg = '';

		const src = sourceLang!;
		const availability = await canTranslate(src, targetLang);

		if (availability === 'unavailable') {
			status = 'unsupported';
			return;
		}

		status = 'translating';

		try {
			const titleTag = event.tags.find(([k]) => k === 'title');
			const summaryTag = event.tags.find(([k]) => k === 'summary');

			const [translatedTitle, translatedSummary] = await translateTexts(
				[titleTag?.[1] || '', summaryTag?.[1] || ''],
				src,
				targetLang
			);

			const translatedContent = await translateMarkdown(event.content, src, targetLang);

			onTranslated({
				title: translatedTitle,
				summary: translatedSummary,
				contentHtml: renderMarkdown(translatedContent),
				targetLang
			});

			status = 'translated';
		} catch (e) {
			console.error('Translation failed', e);
			errorMsg = e instanceof Error ? e.message : 'Translation failed';
			status = 'error';
		}
	}

	function handleRevert() {
		onTranslated(null);
		status = 'idle';
		errorMsg = '';
	}
</script>

{#if shouldOffer}
	<div class="translate-bar">
		{#if status === 'idle'}
			<button class="translate-btn" onclick={handleTranslate}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M5 8l6 6M4 14l6-6 2-2M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>
				</svg>
				Translate to {langName(targetLang)}
			</button>
		{:else if status === 'checking' || status === 'translating'}
			<div class="translate-status loading">
				<span class="spinner" aria-hidden="true"></span>
				{status === 'checking' ? 'Checking availability…' : 'Translating…'}
			</div>
		{:else if status === 'translated'}
			<div class="translate-status translated">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M5 8l6 6M4 14l6-6 2-2M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>
				</svg>
				<span>Translated to {langName(targetLang)}</span>
				<button class="revert-btn" onclick={handleRevert}>Show original</button>
			</div>
		{:else if status === 'unsupported'}
			<div class="translate-status unsupported">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
				</svg>
				Translation unavailable.
				<a href="https://developer.chrome.com/docs/ai/translator-api" target="_blank" rel="noopener noreferrer">
					Requires Chrome 131+
				</a>
			</div>
		{:else if status === 'error'}
			<div class="translate-status error">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
				</svg>
				{errorMsg || 'Translation failed.'}
				<button class="revert-btn" onclick={() => (status = 'idle')}>Try again</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.translate-bar {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--c-accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--c-accent) 20%, transparent);
		font-size: 0.8125rem;
		margin-bottom: var(--space-xl);
		transition: background 0.2s;
	}

	.translate-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		padding: 0;
		color: var(--c-accent);
		font-size: 0.8125rem;
		cursor: pointer;
		font-family: var(--font-sans);
		font-weight: 500;
		transition: color 0.15s;
	}
	.translate-btn:hover {
		color: var(--c-accent-hover);
		background: none;
		border: none;
	}

	.translate-status {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		width: 100%;
	}
	.translate-status.loading {
		color: var(--c-text-secondary);
	}
	.translate-status.translated {
		color: var(--c-text-secondary);
	}
	.translate-status.translated span {
		flex: 1;
	}
	.translate-status.unsupported,
	.translate-status.error {
		color: var(--c-text-secondary);
	}
	.translate-status.error {
		color: var(--c-danger);
	}

	.revert-btn {
		background: none;
		border: 1px solid var(--c-border);
		padding: 2px 10px;
		font-size: 0.75rem;
		color: var(--c-text-secondary);
		border-radius: 20px;
		cursor: pointer;
		flex-shrink: 0;
		font-family: var(--font-sans);
	}
	.revert-btn:hover {
		border-color: var(--c-accent);
		color: var(--c-accent);
		background: none;
	}

	/* Spinner */
	.spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid color-mix(in srgb, var(--c-accent) 30%, transparent);
		border-top-color: var(--c-accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.translate-status a {
		color: var(--c-accent);
		text-decoration: underline;
		font-size: inherit;
	}
</style>
