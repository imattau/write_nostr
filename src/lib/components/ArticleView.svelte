<script lang="ts">
	import type { NostrEvent } from 'nostr-tools';
	import { renderMarkdown } from '$lib/utils/markdown';
	import { profileCache, requestProfiles, displayName } from '$lib/stores/profiles';
	import TranslateButton from '$lib/components/TranslateButton.svelte';

	let { event }: { event: NostrEvent } = $props();

	// Translation overlay – null means show the original
	type Translation = { title: string; summary: string; contentHtml: string; targetLang: string } | null;
	let translation = $state<Translation>(null);

	$effect(() => {
		if (event?.pubkey) requestProfiles([event.pubkey]);
	});

	// Clear translation whenever the underlying event changes
	$effect(() => {
		event;
		translation = null;
	});

	function getTitle(): string {
		const t = event.tags.find(([k]) => k === 'title');
		return t?.[1] || 'Untitled';
	}

	function getSummary(): string {
		const s = event.tags.find(([k]) => k === 'summary');
		return s?.[1] || '';
	}

	function getImage(): string {
		const i = event.tags.find(([k]) => k === 'image');
		return i?.[1] || '';
	}

	function getPublishedAt(): number {
		const p = event.tags.find(([k]) => k === 'published_at');
		return p ? Number(p[1]) : event.created_at;
	}

	function formatDate(ts: number): string {
		return new Date(ts * 1000).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	// Derived display values – prefer translation when available
	let displayTitle = $derived(translation?.title || getTitle());
	let displaySummary = $derived(translation?.summary || getSummary());
	let displayContentHtml = $derived(
		translation?.contentHtml ?? renderMarkdown(event.content)
	);
</script>

<article class="article">
	<header class="header">
		{#if getImage()}
			<img class="featured-image" src={getImage()} alt="" />
		{/if}
		<div class="title-row">
			<h1 class="title">{displayTitle}</h1>
			{#if translation}
				<span class="lang-badge" title="Translated by Chrome AI on device">
					{translation.targetLang.toUpperCase()}
				</span>
			{/if}
		</div>
		<div class="meta">
			<span class="author" title={event.pubkey}>
				{displayName(event.pubkey, $profileCache)}
			</span>
			<span class="date">{formatDate(getPublishedAt())}</span>
		</div>
		{#if displaySummary}
			<p class="summary">{displaySummary}</p>
		{/if}
	</header>

	<TranslateButton {event} onTranslated={(t) => (translation = t)} />

	<div class="content">
		{@html displayContentHtml}
	</div>
</article>

<style>
	.article {
		padding: var(--space-2xl) 0;
	}
	.header {
		margin-bottom: var(--space-xl);
	}
	.featured-image {
		width: 100%;
		border-radius: var(--radius);
		margin-bottom: var(--space-lg);
		max-height: 400px;
		object-fit: cover;
	}
	.title-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-sm);
		margin-bottom: var(--space-md);
	}
	.title {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.2;
		flex: 1;
	}
	.lang-badge {
		flex-shrink: 0;
		margin-top: 6px;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		padding: 2px 7px;
		border-radius: 20px;
		background: color-mix(in srgb, var(--c-accent) 12%, transparent);
		color: var(--c-accent);
		border: 1px solid color-mix(in srgb, var(--c-accent) 25%, transparent);
		font-family: var(--font-mono);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		font-size: 0.875rem;
		color: var(--c-text-secondary);
		margin-bottom: var(--space-md);
	}
	.author {
		font-size: 0.8125rem;
		max-width: 20ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.summary {
		font-size: 1.125rem;
		color: var(--c-text-secondary);
		font-style: italic;
	}
	.content {
		font-family: var(--font-serif);
		font-size: 1.125rem;
		line-height: 1.8;
	}
	.content :global(h2) {
		font-size: 1.5rem;
		margin: var(--space-xl) 0 var(--space-md);
	}
	.content :global(h3) {
		font-size: 1.25rem;
		margin: var(--space-lg) 0 var(--space-md);
	}
	.content :global(p) {
		margin-bottom: var(--space-md);
	}
	.content :global(ul),
	.content :global(ol) {
		margin: var(--space-md) 0;
		padding-left: 1.5rem;
	}
	.content :global(li + li) {
		margin-top: 0.25rem;
	}
	.content :global(blockquote) {
		border-left: 3px solid var(--c-accent);
		padding-left: var(--space-md);
		color: var(--c-text-secondary);
		margin: var(--space-md) 0;
	}
	.content :global(pre) {
		background: var(--c-bg);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		padding: var(--space-md);
		overflow-x: auto;
		font-size: 0.8125rem;
		margin: var(--space-md) 0;
	}
	.content :global(code) {
		font-family: var(--font-mono);
		font-size: 0.875em;
	}
	.content :global(img) {
		max-width: 100%;
		border-radius: var(--radius);
		margin: var(--space-md) 0;
	}
	.content :global(a) {
		color: var(--c-accent);
		text-decoration: underline;
	}

	@media (max-width: 640px) {
		.article {
			padding: var(--space-lg) 0;
		}
		.header {
			margin-bottom: var(--space-lg);
		}
		.featured-image {
			margin-bottom: var(--space-md);
			max-height: 240px;
		}
		.title-row {
			flex-direction: column;
			gap: var(--space-xs);
		}
		.title {
			font-size: 1.5rem;
		}
		.lang-badge {
			margin-top: 0;
		}
		.meta {
			flex-wrap: wrap;
			gap: var(--space-xs) var(--space-sm);
		}
		.author {
			max-width: none;
			white-space: normal;
			word-break: break-word;
		}
		.summary {
			font-size: 1rem;
		}
		.content {
			font-size: 1rem;
			line-height: 1.75;
		}
		.content :global(h2) {
			font-size: 1.25rem;
			margin-top: var(--space-lg);
		}
		.content :global(h3) {
			font-size: 1.1rem;
			margin-top: var(--space-md);
		}
		.content :global(pre) {
			padding: var(--space-sm);
			font-size: 0.75rem;
		}
		.content :global(ul),
		.content :global(ol) {
			padding-left: 1.25rem;
		}
	}
</style>
