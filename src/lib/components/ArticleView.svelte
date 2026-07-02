<script lang="ts">
	import type { NostrEvent } from 'nostr-tools';
	import { renderMarkdown } from '$lib/utils/markdown';
	import { profileCache, requestProfiles, displayName } from '$lib/stores/profiles';

	let { event }: { event: NostrEvent } = $props();

	$effect(() => {
		if (event?.pubkey) requestProfiles([event.pubkey]);
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
</script>

<article class="article">
	<header class="header">
		{#if getImage()}
			<img class="featured-image" src={getImage()} alt="" />
		{/if}
		<h1 class="title">{getTitle()}</h1>
		<div class="meta">
			<span class="author" title={event.pubkey}>
				{displayName(event.pubkey, $profileCache)}
			</span>
			<span class="date">{formatDate(getPublishedAt())}</span>
		</div>
		{#if getSummary()}
			<p class="summary">{getSummary()}</p>
		{/if}
	</header>
	<div class="content">
		{@html renderMarkdown(event.content)}
	</div>
</article>

<style>
	.article {
		padding: var(--space-2xl) 0;
	}
	.header {
		margin-bottom: var(--space-2xl);
	}
	.featured-image {
		width: 100%;
		border-radius: var(--radius);
		margin-bottom: var(--space-lg);
		max-height: 400px;
		object-fit: cover;
	}
	.title {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.2;
		margin-bottom: var(--space-md);
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
</style>
