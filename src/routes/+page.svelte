<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import type { NostrEvent } from 'nostr-tools';
	import { relays } from '$lib/stores/relays';
	import { pubkey } from '$lib/stores/auth';
	import { blocks } from '$lib/stores/social';
	import {
		fetchArticles,
		fetchFollowList,
		fetchArticlesByAuthors,
		fetchInteractionScores,
		fetchOlderArticles,
		fetchOlderArticlesByAuthors
	} from '$lib/nostr/fetch';
	import ArticleCard from '$lib/components/ArticleCard.svelte';

	type FeedMode = 'all' | 'circle' | 'top';

	let mode = $state<FeedMode>('all');
	let articles = $state<NostrEvent[]>([]);
	let scores = $state<Map<string, number>>(new Map());
	let loading = $state(true);
	let loadingMore = $state(false);
	let scoringLoading = $state(false);
	let error = $state('');
	/** Pubkeys followed by the current user — kept so loadMore can reuse them */
	let circleFollowing = $state<string[]>([]);

	/** Articles with blocked authors filtered out — updates reactively when blocks change */
	let visibleArticles = $derived(articles.filter((a) => !$blocks.has(a.pubkey)));

	/** Oldest timestamp among loaded articles — used as `until` cursor for pagination */
	let oldestTimestamp = $derived(
		articles.length > 0 ? Math.min(...articles.map((a) => a.created_at)) : undefined
	);

	onMount(async () => {
		await load('all');
	});

	async function load(nextMode: FeedMode) {
		mode = nextMode;
		loading = true;
		error = '';
		scores = new Map();
		articles = [];

		const relayList = get(relays);

		try {
			if (nextMode === 'all') {
				articles = await fetchArticles(relayList);
			} else if (nextMode === 'circle') {
				const pk = get(pubkey);
				if (!pk) {
					error = 'Log in to view your circle.';
					loading = false;
					return;
				}
				const following = await fetchFollowList(pk, relayList);
				if (!following.length) {
					error = 'No follows found on your connected relays.';
					loading = false;
					return;
				}
				circleFollowing = following;
				articles = await fetchArticlesByAuthors(following, relayList);
			} else if (nextMode === 'top') {
				// Fetch a wider pool then score them
				const pool = await fetchArticles(relayList, 100);
				articles = pool;
				loading = false;

				// Fetch interaction scores in the background
				scoringLoading = true;
				const interactionScores = await fetchInteractionScores(pool, relayList);
				scores = interactionScores;
				// Re-sort by score descending
				articles = [...pool].sort(
					(a, b) => (interactionScores.get(b.id) ?? 0) - (interactionScores.get(a.id) ?? 0)
				);
				scoringLoading = false;
				return;
			}
		} catch (e) {
			error = 'Failed to load articles. Check your relays.';
		}

		loading = false;
	}

	async function loadMore() {
		if (!oldestTimestamp || loadingMore || mode === 'top') return;
		loadingMore = true;
		const relayList = get(relays);
		try {
			let older: NostrEvent[];
			if (mode === 'circle') {
				older = await fetchOlderArticlesByAuthors(circleFollowing, relayList, oldestTimestamp - 1);
			} else {
				older = await fetchOlderArticles(relayList, oldestTimestamp - 1);
			}
			// De-duplicate by id before appending
			const existingIds = new Set(articles.map((a) => a.id));
			const newOnes = older.filter((a) => !existingIds.has(a.id));
			if (newOnes.length) articles = [...articles, ...newOnes];
		} catch {
			// silently fail — don't clear the existing feed
		} finally {
			loadingMore = false;
		}
	}
</script>

<div class="feed">
	<div class="feed-header">
		<h1>Articles</h1>
		<div class="feed-controls">
			<div class="mode-tabs" role="group" aria-label="Feed mode">
				<button
					class="tab"
					class:active={mode === 'all'}
					onclick={() => load('all')}
					disabled={loading}
					aria-pressed={mode === 'all'}
				>
					<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
						<path d="M2 2h5v5H2zm7 0h5v5H9zm-7 7h5v5H2zm7 0h5v5H9z"/>
					</svg>
					All
				</button>
				<button
					class="tab"
					class:active={mode === 'circle'}
					onclick={() => load('circle')}
					disabled={loading}
					aria-pressed={mode === 'circle'}
				>
					<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
						<path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm10-9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm1.5 1c1.5.4 2.5 1.6 2.5 3 0 .7-.6 1-1 1h-1.2C14.6 9.4 14 8.7 14 8c0-.3 0-.6-.1-.9l.6-.1z"/>
					</svg>
					My Circle
				</button>
				<button
					class="tab"
					class:active={mode === 'top'}
					onclick={() => load('top')}
					disabled={loading}
					aria-pressed={mode === 'top'}
				>
					<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
						<path d="M8 1l1.8 3.6L14 5.3l-3 2.9.7 4.1L8 10.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7z"/>
					</svg>
					Top Articles
				</button>
			</div>
			<button
				class="refresh-btn"
				onclick={() => load(mode)}
				disabled={loading || scoringLoading}
				title="Refresh"
				aria-label="Refresh feed"
			>
				<svg
					class:spinning={loading || scoringLoading}
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="currentColor"
					aria-hidden="true"
				>
					<path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.06-3.41L9 7h6V1l-1.35 1.35z"/>
				</svg>
				{loading ? 'Loading…' : scoringLoading ? 'Scoring…' : 'Refresh'}
			</button>
		</div>
	</div>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if loading}
		<p class="loading">
			{mode === 'circle' ? 'Fetching your follows…' : mode === 'top' ? 'Fetching articles…' : 'Loading articles from relays…'}
		</p>
	{:else if articles.length === 0}
		<p class="empty">No articles found. Try adding more relays in Settings.</p>
	{:else}
		{#if mode === 'top' && scoringLoading}
			<p class="scoring-notice">
				<span class="pulse">●</span> Calculating interaction scores…
			</p>
		{/if}
		<div class="article-list">
			{#each visibleArticles as article (article.id)}
				<ArticleCard
					event={article}
					relays={$relays}
					score={mode === 'top' ? (scores.get(article.id) ?? 0) : undefined}
				/>
			{/each}
		</div>
		{#if mode !== 'top'}
			<div class="load-more-wrap">
				<button
					class="load-more-btn"
					onclick={loadMore}
					disabled={loadingMore}
					aria-label="Load older articles"
				>
					{#if loadingMore}
						<svg class="spinning" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.06-3.41L9 7h6V1l-1.35 1.35z"/>
						</svg>
						Loading…
					{:else}
						Load More
					{/if}
				</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.feed {
		padding: var(--space-xl) 0;
	}
	.feed-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-md);
		margin-bottom: var(--space-lg);
		flex-wrap: wrap;
	}
	.feed-header h1 {
		font-size: 1.25rem;
		font-weight: 600;
	}
	.feed-controls {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		flex-wrap: wrap;
	}

	/* Tab group */
	.mode-tabs {
		display: flex;
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.tab {
		border: none;
		border-radius: 0;
		background: var(--c-surface);
		color: var(--c-text-secondary);
		font-size: 0.8125rem;
		padding: 6px 12px;
		gap: 5px;
		transition: background 0.15s, color 0.15s;
	}
	.tab:hover:not(:disabled) {
		background: var(--c-bg);
		color: var(--c-text);
		border-color: transparent;
	}
	.tab.active {
		background: var(--c-accent);
		color: #fff;
	}
	.tab.active:hover {
		background: var(--c-accent-hover);
	}
	/* Dividers between tabs */
	.tab + .tab {
		border-left: 1px solid var(--c-border);
	}

	/* Refresh button */
	.refresh-btn {
		font-size: 0.8125rem;
		padding: 6px 12px;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.spinning {
		animation: spin 0.8s linear infinite;
		display: inline-block;
	}

	/* Scoring notice */
	.scoring-notice {
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
		margin-bottom: var(--space-md);
		display: flex;
		align-items: center;
		gap: var(--space-xs);
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50%  { opacity: 0.3; }
	}
	.pulse {
		color: var(--c-accent);
		animation: pulse 1.2s ease-in-out infinite;
	}

	.article-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}
	.error {
		color: var(--c-danger);
		margin-bottom: var(--space-md);
	}
	.loading,
	.empty {
		color: var(--c-text-secondary);
		text-align: center;
		padding: var(--space-2xl) 0;
	}

	/* Load More */
	.load-more-wrap {
		display: flex;
		justify-content: center;
		margin-top: var(--space-lg);
	}
	.load-more-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.875rem;
		padding: 8px 24px;
		border-radius: var(--radius);
		background: transparent;
		border: 1px solid var(--c-border);
		color: var(--c-text-secondary);
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}
	.load-more-btn:hover:not(:disabled) {
		background: var(--c-surface);
		color: var(--c-text);
		border-color: var(--c-accent);
	}
	.load-more-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
