<script lang="ts">
	import type { NostrEvent } from 'nostr-tools';
	import { nip19 } from 'nostr-tools';
	import { encodeNaddr } from '$lib/utils/nip19';
	import { renderMarkdown, extractNostrPubkeys } from '$lib/utils/markdown';
	import { profileCache, requestProfiles, displayName } from '$lib/stores/profiles';
	import type { NostrProfile } from '$lib/nostr/profiles';
	import { relays } from '$lib/stores/relays';
	import { findRelatedEvents } from '$lib/graph';
	import TranslateButton from '$lib/components/TranslateButton.svelte';
	import InteractionButtons from '$lib/components/InteractionButtons.svelte';

	let { event }: { event: NostrEvent } = $props();

	// Translation overlay – null means show the original
	type Translation = { title: string; summary: string; contentHtml: string; targetLang: string } | null;
	let translation = $state<Translation>(null);

	$effect(() => {
		$relays;
		if (event?.pubkey) requestProfiles([event.pubkey]);
	});

	$effect(() => {
		$relays;
		if (!event?.content) return;
		const linkedPubkeys = extractNostrPubkeys(event.content);
		if (linkedPubkeys.length > 0) requestProfiles(linkedPubkeys);
	});

	// Clear translation whenever the underlying event changes
	$effect(() => {
		event;
		translation = null;
	});

	// Similar articles via vector search
	let similarArticles = $state<NostrEvent[]>([]);
	let similarLoading = $state(false);

	$effect(() => {
		event;
		similarArticles = [];
		if (event?.id) {
			similarLoading = true;
			findRelatedEvents(event.id, 0.2, 5)
				.then((articles) => { similarArticles = articles; })
				.catch(() => {})
				.finally(() => { similarLoading = false; });
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

	function getNostrLinkLabel(
		href: string,
		innerHtml: string,
		profileMap: { get(key: string): NostrProfile | null | undefined }
	): string | null {
		const match = href.match(/^https:\/\/njump\.me\/([a-z0-9]+)$/i);
		if (!match) return null;

		const code = match[1];
		const rawText = innerHtml.replace(/<[^>]*>/g, '').trim();
		const rawHref = `nostr:${code}`;
		const renderedHref = `https://njump.me/${code}`;

		if (rawText !== rawHref && rawText !== code && rawText !== renderedHref) {
			return null;
		}

		try {
			const decoded = nip19.decode(code);
			if (decoded.type === 'npub') {
				return displayName(decoded.data, profileMap);
			}
			if (decoded.type === 'nprofile') {
				return displayName(decoded.data.pubkey, profileMap);
			}
			if (decoded.type === 'naddr') {
				return displayName(decoded.data.pubkey, profileMap);
			}
			if (decoded.type === 'nevent' && decoded.data.author) {
				return displayName(decoded.data.author, profileMap);
			}
		} catch {
			// Ignore invalid Nostr URIs and leave the label unchanged.
		}

		return null;
	}

	function renderContentHtml(
		html: string,
		profileMap: { get(key: string): NostrProfile | null | undefined }
	): string {
		return html.replace(
			/<a\b([^>]*?)href="([^"]+)"([^>]*)>(.*?)<\/a>/g,
			(match, before, href, after, innerHtml) => {
				const label = getNostrLinkLabel(href, innerHtml, profileMap);
				if (!label) return match;
				return `<a${before}href="${href}"${after}>${label}</a>`;
			}
		);
	}

	let profileMap = $derived($profileCache);
	let renderedContentHtml = $derived(renderContentHtml(displayContentHtml, profileMap));
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
				{displayName(event.pubkey, profileMap)}
			</span>
			<span class="date">{formatDate(getPublishedAt())}</span>
			<InteractionButtons {event} />
		</div>
		{#if displaySummary}
			<p class="summary">{displaySummary}</p>
		{/if}
	</header>

	<TranslateButton {event} onTranslated={(t) => (translation = t)} />

	<div class="content">
		{@html renderedContentHtml}
	</div>

	{#if similarArticles.length > 0}
		<section class="similar">
			<h2 class="similar-heading">Similar Articles</h2>
			<div class="similar-list">
				{#each similarArticles as sa (sa.id)}
					<a href="/article/{encodeNaddr(sa.pubkey, sa.tags.find(([k]) => k === 'd')?.[1] || '', $relays)}" class="similar-item">
						<span class="similar-title">{sa.tags.find(([k]) => k === 'title')?.[1] || 'Untitled'}</span>
						<span class="similar-author">{displayName(sa.pubkey, profileMap)}</span>
					</a>
				{/each}
			</div>
		</section>
	{/if}
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
	.similar {
		margin-top: var(--space-2xl);
		padding-top: var(--space-xl);
		border-top: 1px solid var(--c-border);
	}
	.similar-heading {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: var(--space-md);
	}
	.similar-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}
	.similar-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		text-decoration: none;
		color: inherit;
		transition: border-color 0.15s;
	}
	.similar-item:hover {
		border-color: var(--c-accent);
	}
	.similar-title {
		font-size: 0.875rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}
	.similar-author {
		font-size: 0.75rem;
		color: var(--c-text-secondary);
		flex-shrink: 0;
	}
</style>
