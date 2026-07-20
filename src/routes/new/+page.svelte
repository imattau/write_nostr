<script lang="ts">
	import Editor from '$lib/components/Editor.svelte';
	import { publishArticle } from '$lib/nostr/publish';
	import { resolveNaddr } from '$lib/nostr/resolve';
	import { auth, pubkey } from '$lib/stores/auth';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { drafts } from '$lib/stores/drafts';
	import type { NostrEvent } from 'nostr-tools';

	let publishing = $state(false);
	let result = $state<{ naddr?: string; error?: string }>({});
	let loadingArticle = $state(false);
	let loadError = $state('');

	let draft = $derived($page.url.searchParams.get('id') ? drafts.getById($page.url.searchParams.get('id')!) : undefined);
	let editNaddr = $derived($page.url.searchParams.get('naddr') || '');

	let editArticle = $state<NostrEvent | null>(null);

	$effect(() => {
		if (!editNaddr) { editArticle = null; loadError = ''; return; }
		loadingArticle = true;
		loadError = '';
		resolveNaddr(editNaddr).then(({ event }) => {
			if (event && event.pubkey === $pubkey) {
				editArticle = event;
			} else if (event) {
				loadError = 'You can only edit your own articles.';
				editArticle = null;
			} else {
				loadError = 'Article not found.';
				editArticle = null;
			}
		}).catch(() => {
			loadError = 'Failed to load article.';
			editArticle = null;
		}).finally(() => {
			loadingArticle = false;
		});
	});

	let initialDraft = $derived.by(() => {
		if (editArticle) {
			const d = editArticle.tags.find(([k]) => k === 'd')?.[1] || '';
			return {
				id: d,
				title: editArticle.tags.find(([k]) => k === 'title')?.[1] || '',
				content: editArticle.content,
				summary: editArticle.tags.find(([k]) => k === 'summary')?.[1] || '',
				image: editArticle.tags.find(([k]) => k === 'image')?.[1] || '',
				tags: editArticle.tags.filter(([k]) => k === 't').map(([, v]) => v),
				updatedAt: Date.now(),
				publishedAt: Number(editArticle.tags.find(([k]) => k === 'published_at')?.[1]) || editArticle.created_at
			};
		}
		return undefined;
	});

	async function handlePublish(opts: {
		title: string;
		content: string;
		summary: string;
		tags: string[];
		image: string;
		identifier: string;
	}) {
		publishing = true;
		result = {};
		try {
			const res = await publishArticle({
				title: opts.title,
				content: opts.content,
				summary: opts.summary || undefined,
				image: opts.image || undefined,
				tags: opts.tags,
				identifier: opts.identifier,
				publishedAt: editArticle
					? Number(editArticle.tags.find(([k]) => k === 'published_at')?.[1]) || editArticle.created_at
					: Math.floor(Date.now() / 1000)
			});
			if (res.success && res.naddr) {
				// remove the draft identifier so auto-save doesn't conflict if they edit again
				drafts.remove(opts.identifier);
				goto(`/article/${res.naddr}`);
			} else {
				result = { error: res.error || 'Publish failed' };
			}
		} catch (e) {
			result = { error: String(e) };
		}
		publishing = false;
	}
</script>

{#if result.error}
	<div class="error-bar">
		{result.error}
		<button onclick={() => (result = {})}>Dismiss</button>
	</div>
{/if}

{#if loadError}
	<div class="error-bar">
		{loadError}
		<a href="/" class="back-link">Back to articles</a>
	</div>
{/if}

{#if loadingArticle}
	<div class="loading">Loading article...</div>
{:else if !loadError}
	<div class="publishing-overlay" class:visible={publishing}>
		<publishing>Publishing...</publishing>
	</div>

	<Editor draft={initialDraft ?? draft} onPublish={handlePublish} />
{/if}

<style>
	.error-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-sm) var(--space-md);
		background: var(--c-danger);
		color: #fff;
		font-size: 0.875rem;
	}
	.error-bar button, .error-bar .back-link {
		color: #fff;
		border-color: rgba(255,255,255,0.3);
	}
	.back-link {
		color: #fff;
		text-decoration: underline;
		font-size: 0.875rem;
	}
	.loading {
		text-align: center;
		padding: var(--space-2xl) 0;
		color: var(--c-text-secondary);
	}
	.publishing-overlay {
		display: none;
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.5);
		align-items: center;
		justify-content: center;
		z-index: 100;
		color: #fff;
		font-size: 1.125rem;
	}
	.publishing-overlay.visible {
		display: flex;
	}
</style>
