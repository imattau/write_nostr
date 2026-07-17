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
		fetchOlderArticles
	} from '$lib/nostr/fetch';
	import { getAllEventsByKind, TTL, rankEventsByCentroid, indexEventVector } from '$lib/graph';
	import { getEmbedding, getArticleText } from '$lib/embeddings';
	import ArticleCard from '$lib/components/ArticleCard.svelte';
	import SemanticSearch from '$lib/components/SemanticSearch.svelte';

	type FeedMode = 'all' | 'circle' | 'top';

	let mode = $state<FeedMode>('all');
	let articles = $state<NostrEvent[]>([]);
	let scores = $state<Map<string, number>>(new Map());
	let loading = $state(true);
	let loadingMore = $state(false);
	let scoringLoading = $state(false);
	let error = $state('');
	let tagFilter = $state<string | null>(null);
	let cachedArticles = $state<NostrEvent[]>([]);
	/** Pubkeys followed by the current user — kept so loadMore can reuse them */
	let circleFollowing = $state<string[]>([]);

	/** Articles with blocked authors filtered out — updates reactively when blocks change */
	let visibleArticles = $derived(articles.filter((a) => !$blocks.has(a.pubkey)));

	/** Sweep the cache for all kind:30023 events when a tag filter is active */
	$effect(() => {
		if (tagFilter) {
			getAllEventsByKind(30023, TTL.articles).then((events) => {
				cachedArticles = events;
			});
		} else {
			cachedArticles = [];
		}
	});

	/** Merge in-memory + cached articles, deduplicate, then filter by active tag */
	let filteredArticles = $derived.by(() => {
		if (!tagFilter) return visibleArticles;

		const blocked = $blocks;
		const seen = new Set<string>();
		const merged: NostrEvent[] = [];

		// In-memory articles come first (they're already block-filtered)
		for (const a of visibleArticles) {
			if (!seen.has(a.id)) {
				seen.add(a.id);
				merged.push(a);
			}
		}
		// Cache sweep articles fill in the rest, with block filtering
		for (const a of cachedArticles) {
			if (!seen.has(a.id) && !blocked.has(a.pubkey)) {
				seen.add(a.id);
				merged.push(a);
			}
		}

		return merged.filter((a) => a.tags.some(([k, v]) => k === 't' && v === tagFilter));
	});

	/** Oldest timestamp among loaded articles — used as `until` cursor for pagination */
	let oldestTimestamp = $derived(
		articles.length > 0
			? articles.reduce((min, a) => (a.created_at < min ? a.created_at : min), articles[0].created_at)
			: undefined
	);

	/** Oldest timestamp among articles matching the active tag filter — used for tag-filtered pagination */
	let oldestTaggedTimestamp = $derived.by(() => {
		if (!tagFilter || articles.length === 0) return undefined;
		const tagged = articles.filter((a) => a.tags.some(([k, v]) => k === 't' && v === tagFilter));
		if (tagged.length === 0) return undefined;
		return tagged.reduce((min, a) => (a.created_at < min ? a.created_at : min), tagged[0].created_at);
	});

	onMount(async () => {
		await load('all');
	});

	async function load(nextMode: FeedMode, force = false) {
		mode = nextMode;
		tagFilter = null;
		loading = true;
		error = '';
		scores = new Map();
		articles = [];

		const relayList = get(relays);

		try {
			if (nextMode === 'all') {
				articles = await fetchArticles(relayList, force ? { skipCache: true } : undefined);
			} else if (nextMode === 'circle') {
				const pk = get(pubkey);
				if (!pk) {
					error = 'Log in to view your circle.';
					loading = false;
					return;
				}
				const following = await fetchFollowList(pk, relayList, force);
				if (!following.length) {
					error = 'No follows found on your connected relays.';
					loading = false;
					return;
				}
				circleFollowing = following;
				articles = await fetchArticles(relayList, { authors: following, skipCache: force });
			} else if (nextMode === 'top') {
				// Fetch a wider pool then rank by vector centroid
				const pool = await fetchArticles(relayList, { limit: 100, skipCache: force });
				articles = pool;
				loading = false;

				// Ensure articles have vectors computed, then rank by
				// similarity to the centroid (most representative first)
				scoringLoading = true;
				const ids = pool.map((a) => a.id);
				await embedIndexedArticles(ids, pool);
				const ranked = await rankEventsByCentroid(ids);
				articles = ranked.map((id) => pool.find((a) => a.id === id)!).filter(Boolean);
				scoringLoading = false;
				return;
			}
		} catch (e) {
			error = 'Failed to load articles. Check your relays.';
		}

		loading = false;
	}

	async function embedIndexedArticles(_ids: string[], pool: NostrEvent[]) {
		await Promise.all(
			pool.map(async (a) => {
				const text = getArticleText(a);
				if (!text) return;
				try {
					const vec = await getEmbedding(text);
					await indexEventVector(a.id, vec);
				} catch {}
			})
		);
	}

	async function loadMore() {
		const cursor = tagFilter ? oldestTaggedTimestamp : oldestTimestamp;
		if (!cursor || loadingMore || mode === 'top') return;
		loadingMore = true;
		const relayList = get(relays);
		try {
			let older: NostrEvent[];
			if (mode === 'circle') {
				older = await fetchOlderArticles(relayList, cursor - 1, {
					authors: circleFollowing,
					...(tagFilter ? { tag: tagFilter } : {})
				});
			} else {
				older = await fetchOlderArticles(relayList, cursor - 1, {
					...(tagFilter ? { tag: tagFilter } : {})
				});
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
			{#if tagFilter}
				<div class="tag-filter-chip">
					<span class="tag-filter-label">#{tagFilter}</span>
					<button class="tag-filter-clear" onclick={() => tagFilter = null} aria-label="Clear tag filter">&times;</button>
				</div>
			{/if}
			<button
				class="refresh-btn"
				onclick={() => load(mode, true)}
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
				{loading ? 'Loading…' : scoringLoading ? 'Ranking…' : 'Refresh'}
			</button>
		</div>
	</div>

	<SemanticSearch />

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
				<span class="pulse">●</span> Ranking by topic relevance…
			</p>
		{/if}
		{#if tagFilter && filteredArticles.length === 0}
			<p class="empty">No articles tagged <strong>#{tagFilter}</strong>.</p>
		{:else}
			<div class="article-list">
				{#each filteredArticles as article (article.id)}
					<ArticleCard
						event={article}
						relays={$relays}
						onTagClick={(tag) => tagFilter = tagFilter === tag ? null : tag}
					/>
				{/each}
			</div>
		{/if}
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

	/* Tag filter chip */
	.tag-filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px 8px;
		border-radius: var(--radius);
		background: var(--c-accent);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 500;
		white-space: nowrap;
	}
	.tag-filter-label {
		padding: 0 2px;
	}
	.tag-filter-clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
		border-radius: 50%;
		transition: background 0.15s;
	}
	.tag-filter-clear:hover {
		background: rgba(255,255,255,0.2);
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

	@media (max-width: 640px) {
		.feed-header {
			display: flex;
			flex-direction: column;
			gap: var(--space-sm);
			margin-bottom: var(--space-md);
		}
		.feed-controls {
			width: 100%;
			align-items: stretch;
		}
		.mode-tabs {
			width: 100%;
			flex-wrap: wrap;
		}
		.tab {
			flex: 1 1 50%;
			justify-content: center;
		}
		.refresh-btn {
			width: 100%;
			justify-content: center;
		}
	}
</style>
