<script lang="ts">
	import type { NostrEvent } from 'nostr-tools';
	import { encodeNaddr } from '$lib/utils/nip19';
	import { profileCache, requestProfiles, displayName } from '$lib/stores/profiles';
	import { pubkey as myPubkey } from '$lib/stores/auth';
	import {
		follows,
		blocks,
		followUser,
		unfollowUser,
		blockUser,
		unblockUser,
		loadSocialLists
	} from '$lib/stores/social';

	import { relays } from '$lib/stores/relays';
	import {
		bookmarkedCoordinates,
		addBookmark,
		removeBookmark,
		loadBookmarks
	} from '$lib/stores/bookmarks';
	import {
		pinnedCoordinates,
		addPin,
		removePin,
		loadPins
	} from '$lib/stores/pins';

	let { event, relays: relaysProp, score = undefined, onTagClick = undefined }: {
		event: NostrEvent;
		relays: string[];
		score?: number;
		onTagClick?: (tag: string) => void;
	} = $props();

	// Request profile for author whenever the event, relay list, or profile
	// cache changes. Retries on profile-fetch failures when other profiles
	// arrive (which triggers this effect via $profileCache).
	$effect(() => {
		$profileCache;
		if (event?.pubkey && $relays.length > 0) requestProfiles([event.pubkey]);
	});

	// Load social lists once when we have a logged-in user
	$effect(() => {
		if ($myPubkey) {
			loadSocialLists();
			loadBookmarks();
			loadPins();
		}
	});

	function getTitle(): string {
		const t = event.tags.find(([k]) => k === 'title');
		return t?.[1] || 'Untitled';
	}

	function getSummary(): string {
		const s = event.tags.find(([k]) => k === 'summary');
		return s?.[1] || '';
	}

	function getTags(): string[] {
		return event.tags.filter(([k]) => k === 't').map(([, v]) => v);
	}

	function getPublishedAt(): number {
		const p = event.tags.find(([k]) => k === 'published_at');
		return p ? Number(p[1]) : event.created_at;
	}

	function getIdentifier(): string {
		const d = event.tags.find(([k]) => k === 'd');
		return d?.[1] || '';
	}

	function getCoordinate(): string {
		return `30023:${event.pubkey}:${getIdentifier()}`;
	}

	function timeAgo(ts: number): string {
		const diff = Date.now() / 1000 - ts;
		if (diff < 3600) return `${Math.round(diff / 60)}m`;
		if (diff < 86400) return `${Math.round(diff / 3600)}h`;
		return `${Math.round(diff / 86400)}d`;
	}

	const MAX_TAGS = 3;
	let naddr = $derived(encodeNaddr(event.pubkey, getIdentifier(), relaysProp));
	let authorName = $derived(displayName(event.pubkey, $profileCache));
	let visibleTags = $derived(getTags().slice(0, MAX_TAGS));
	let hiddenTagCount = $derived(Math.max(0, getTags().length - MAX_TAGS));

	/** True only if the current user is logged in and is not the article author */
	let showSocialActions = $derived($myPubkey !== null && $myPubkey !== event.pubkey);

	let isFollowing = $derived($follows.has(event.pubkey));
	let isBlocked = $derived($blocks.has(event.pubkey));
	let isBookmarked = $derived($bookmarkedCoordinates.has(getCoordinate()));
	let isPinned = $derived($pinnedCoordinates.has(getCoordinate()));

	let followBusy = $state(false);
	let blockBusy = $state(false);
	let bookmarkBusy = $state(false);
	let pinBusy = $state(false);

	async function handleFollow(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (followBusy) return;
		followBusy = true;
		try {
			if (isFollowing) await unfollowUser(event.pubkey);
			else await followUser(event.pubkey);
		} finally {
			followBusy = false;
		}
	}

	async function handleBlock(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (blockBusy) return;
		blockBusy = true;
		try {
			if (isBlocked) await unblockUser(event.pubkey);
			else await blockUser(event.pubkey);
		} finally {
			blockBusy = false;
		}
	}

	async function handleBookmark(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (bookmarkBusy) return;
		bookmarkBusy = true;
		try {
			const coordinate = getCoordinate();
			if (isBookmarked) await removeBookmark(coordinate);
			else await addBookmark(coordinate, { private: true });
		} finally {
			bookmarkBusy = false;
		}
	}

	async function handlePin(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (pinBusy) return;
		pinBusy = true;
		try {
			const coordinate = getCoordinate();
			if (isPinned) await removePin(coordinate);
			else await addPin(coordinate, { private: true });
		} finally {
			pinBusy = false;
		}
	}
</script>

<a href={`/article/${naddr}`} class="card">
	<h2 class="title">{getTitle()}</h2>
	{#if getSummary()}
		<p class="summary">{getSummary()}</p>
	{/if}
	<div class="meta">
		<span class="author" title={event.pubkey}>{authorName}</span>

		{#if showSocialActions}
			<!-- Follow button -->
			<button
				class="social-btn follow-btn"
				class:active={isFollowing}
				onclick={handleFollow}
				disabled={followBusy}
				title={isFollowing ? 'Unfollow author' : 'Follow author'}
				aria-label={isFollowing ? 'Unfollow author' : 'Follow author'}
			>
				{#if isFollowing}
					<!-- Person with checkmark (following) -->
					<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
						<path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4c.5 0 1 0 1.5.1M13 10l1.5 1.5L17 9"/>
						<path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 3 1 4 2"/>
						<polyline points="13,10 14.5,11.5 17,9"/>
					</svg>
				{:else}
					<!-- Person with plus (not following) -->
					<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
						<path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3z"/>
						<line x1="13" y1="7" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/>
						<line x1="10" y1="10" x2="16" y2="10" stroke="currentColor" stroke-width="1.5"/>
					</svg>
				{/if}
			</button>

			<!-- Block button -->
			<button
				class="social-btn block-btn"
				class:active={isBlocked}
				onclick={handleBlock}
				disabled={blockBusy}
				title={isBlocked ? 'Unblock author' : 'Block author'}
				aria-label={isBlocked ? 'Unblock author' : 'Block author'}
			>
				<!-- Shield / block icon -->
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
					<line x1="3.5" y1="3.5" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="1.5"/>
				</svg>
			</button>

			<!-- Bookmark button -->
			<button
				class="social-btn bookmark-btn"
				class:active={isBookmarked}
				onclick={handleBookmark}
				disabled={bookmarkBusy}
				title={isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
				aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
			>
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path d="M4 1.5h8a1 1 0 0 1 1 1V15l-5-3.5L3 15V2.5a1 1 0 0 1 1-1z" />
				</svg>
			</button>

			<!-- Pin button -->
			<button
				class="social-btn pin-btn"
				class:active={isPinned}
				onclick={handlePin}
				disabled={pinBusy}
				title={isPinned ? 'Unpin article' : 'Pin article'}
				aria-label={isPinned ? 'Unpin article' : 'Pin article'}
			>
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path d="M8 1l1.5 4.5L14 7l-4 3 .5 5-2.5-3-2.5 3 .5-5-4-3 4.5-1.5z" />
				</svg>
			</button>
		{/if}

		<span class="time">{timeAgo(getPublishedAt())}</span>
		{#if score !== undefined && score > 0}
			<span class="score" title="Interaction score: likes + boosts + zaps">⚡ {score}</span>
		{/if}
		{#each visibleTags as tag}
			<button
				class="tag"
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onTagClick?.(tag);
				}}
			>{tag}</button>
		{/each}
		{#if hiddenTagCount > 0}
			<span class="tag tag-overflow">+{hiddenTagCount}</span>
		{/if}
	</div>
</a>

<style>
	.card {
		display: block;
		padding: var(--space-md) var(--space-lg);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		background: var(--c-surface);
		text-decoration: none;
		color: inherit;
		transition: border-color 0.15s;
	}
	.card:hover {
		border-color: var(--c-accent);
	}
	.title {
		font-size: 1.125rem;
		font-weight: 600;
		margin-bottom: var(--space-xs);
	}
	.summary {
		font-size: 0.875rem;
		color: var(--c-text-secondary);
		margin-bottom: var(--space-sm);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		font-size: 0.75rem;
		color: var(--c-text-secondary);
	}
	.author {
		max-width: 18ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Social action buttons ─────────────────────────────────── */
	.social-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 1px solid var(--c-border);
		border-radius: 4px;
		background: transparent;
		color: var(--c-text-secondary);
		cursor: pointer;
		transition: color 0.15s, background 0.15s, border-color 0.15s, transform 0.1s;
		flex-shrink: 0;
	}
	.social-btn:hover:not(:disabled) {
		transform: scale(1.15);
	}
	.social-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* Follow */
	.follow-btn:hover:not(:disabled) {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 10%, transparent);
	}
	.follow-btn.active {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 15%, transparent);
	}
	.follow-btn.active:hover:not(:disabled) {
		color: var(--c-accent-hover, var(--c-accent));
		background: color-mix(in srgb, var(--c-accent) 25%, transparent);
	}

	/* Block */
	.block-btn:hover:not(:disabled) {
		color: var(--c-danger, #e55);
		border-color: var(--c-danger, #e55);
		background: color-mix(in srgb, var(--c-danger, #e55) 10%, transparent);
	}
	.block-btn.active {
		color: var(--c-danger, #e55);
		border-color: var(--c-danger, #e55);
		background: color-mix(in srgb, var(--c-danger, #e55) 15%, transparent);
	}
	.block-btn.active:hover:not(:disabled) {
		background: color-mix(in srgb, var(--c-danger, #e55) 25%, transparent);
	}

	/* Bookmark */
	.bookmark-btn:hover:not(:disabled) {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 10%, transparent);
	}
	.bookmark-btn.active {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 15%, transparent);
	}

	/* Pin */
	.pin-btn:hover:not(:disabled) {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 10%, transparent);
	}
	.pin-btn.active {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 15%, transparent);
	}

	.tag {
		padding: 1px 6px;
		background: var(--c-bg);
		border-radius: 4px;
		white-space: nowrap;
		border: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.tag:hover {
		background: var(--c-accent);
		color: #fff;
	}
	.tag-overflow {
		opacity: 0.5;
		font-style: italic;
		cursor: default;
	}
	.score {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 1px 6px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--c-accent) 12%, transparent);
		color: var(--c-accent);
		font-weight: 600;
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.card {
			padding: var(--space-md);
		}
		.title {
			font-size: 1rem;
		}
		.summary {
			-webkit-line-clamp: 3;
			line-clamp: 3;
		}
		.meta {
			flex-wrap: wrap;
			gap: var(--space-xs);
		}
		.author {
			max-width: none;
			white-space: normal;
			word-break: break-word;
		}
		.tag,
		.score {
			font-size: 0.6875rem;
		}
		.social-btn {
			width: 24px;
			height: 24px;
		}
	}
</style>
