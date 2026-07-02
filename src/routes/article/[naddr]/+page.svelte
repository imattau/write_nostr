<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { resolveNaddr } from '$lib/nostr/resolve';
	import ArticleView from '$lib/components/ArticleView.svelte';
	import type { NostrEvent } from 'nostr-tools';

	let event = $state<NostrEvent | null>(null);
	let loading = $state(true);
	let error = $state('');

	onMount(async () => {
		await loadArticle();
	});

	async function loadArticle() {
		loading = true;
		error = '';
		try {
			const naddr = $page.params.naddr;
			const result = await resolveNaddr(naddr);
			if (result.event) {
				event = result.event;
			} else {
				error = 'Article not found.';
			}
		} catch (e) {
			error = 'Failed to load article.';
		}
		loading = false;
	}
</script>

<div class="reader">
	<a href="/" class="back">&larr; Back to articles</a>

	{#if loading}
		<p class="loading">Loading article...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if event}
		<ArticleView {event} />
	{/if}
</div>

<style>
	.reader {
		max-width: var(--measure);
		margin: 0 auto;
		padding: 0 var(--space-md);
	}
	.back {
		display: inline-block;
		margin: var(--space-md) 0;
		font-size: 0.875rem;
		color: var(--c-text-secondary);
	}
	.loading,
	.error {
		text-align: center;
		padding: var(--space-2xl) 0;
		color: var(--c-text-secondary);
	}
	.error {
		color: var(--c-danger);
	}
</style>
