<script lang="ts">
	import Editor from '$lib/components/Editor.svelte';
	import { publishArticle } from '$lib/nostr/publish';
	import { auth } from '$lib/stores/auth';
	import { goto } from '$app/navigation';

	let publishing = $state(false);
	let result = $state<{ naddr?: string; error?: string }>({});

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
				publishedAt: Math.floor(Date.now() / 1000)
			});
			if (res.success && res.naddr) {
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

<div class="publishing-overlay" class:visible={publishing}>
	<publishing>Publishing...</publishing>
</div>

<Editor onPublish={handlePublish} />

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
	.error-bar button {
		color: #fff;
		border-color: rgba(255,255,255,0.3);
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
