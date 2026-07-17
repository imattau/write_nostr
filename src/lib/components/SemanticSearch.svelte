<script lang="ts">
	import type { NostrEvent } from 'nostr-tools';
	import { getEmbedding } from '$lib/embeddings';
	import { searchSimilarEvents } from '$lib/graph';
	import ArticleCard from '$lib/components/ArticleCard.svelte';
	import { relays } from '$lib/stores/relays';

	let query = $state('');
	let results = $state<NostrEvent[]>([]);
	let searching = $state(false);
	let hasSearched = $state(false);
	let error = $state('');

	async function handleSearch() {
		const q = query.trim();
		if (!q || searching) return;
		searching = true;
		hasSearched = true;
		error = '';
		results = [];
		try {
			const vector = await getEmbedding(q);
			results = await searchSimilarEvents(Array.from(vector), 0.15, 20);
		} catch (e) {
			error = 'Search failed. The AI model may still be downloading.';
			console.warn('[semantic search]', e);
		} finally {
			searching = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleSearch();
	}
</script>

<div class="semantic-search">
	<div class="search-row">
		<input
			type="text"
			class="search-input"
			placeholder="Search articles by meaning…"
			bind:value={query}
			onkeydown={handleKeydown}
			disabled={searching}
			aria-label="Semantic search"
		/>
		<button
			class="search-btn"
			onclick={handleSearch}
			disabled={searching || !query.trim()}
			aria-label="Search"
		>
			{#if searching}
				<span class="spinner"></span>
			{:else}
				<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
				</svg>
			{/if}
		</button>
	</div>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if results.length > 0}
		<div class="results">
			{#each results as article (article.id)}
				<ArticleCard event={article} relays={$relays} />
			{/each}
		</div>
	{:else if hasSearched && !searching && !error}
		<p class="empty">No similar articles found. Try a different search.</p>
	{/if}
</div>

<style>
	.semantic-search {
		margin-bottom: var(--space-lg);
	}
	.search-row {
		display: flex;
		gap: var(--space-sm);
	}
	.search-input {
		flex: 1;
		padding: 8px 12px;
		font-size: 0.875rem;
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		background: var(--c-surface);
		color: inherit;
		outline: none;
		transition: border-color 0.15s;
	}
	.search-input:focus {
		border-color: var(--c-accent);
	}
	.search-input:disabled {
		opacity: 0.6;
	}
	.search-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		background: var(--c-surface);
		color: var(--c-text-secondary);
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
		flex-shrink: 0;
	}
	.search-btn:hover:not(:disabled) {
		border-color: var(--c-accent);
		color: var(--c-accent);
	}
	.search-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid var(--c-border);
		border-top-color: var(--c-accent);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.results {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
		margin-top: var(--space-md);
	}
	.empty {
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
		text-align: center;
		padding: var(--space-lg) 0;
	}
	.error {
		font-size: 0.8125rem;
		color: var(--c-danger);
		margin-top: var(--space-sm);
	}
</style>
