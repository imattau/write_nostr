<script lang="ts">
	import { drafts } from '$lib/stores/drafts';
	import { goto } from '$app/navigation';
</script>

<div class="drafts-page">
	<h1>Drafts</h1>

	{#if $drafts.length === 0}
		<p class="empty">No drafts yet. <a href="/new">Write something!</a></p>
	{:else}
		<div class="draft-list">
			{#each $drafts as draft (draft.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div
					class="draft-item"
					role="button"
					tabindex="0"
					onclick={() => goto('/new')}
					onkeydown={(e) => e.key === 'Enter' && goto('/new')}
				>
					<div class="draft-title">{draft.title || 'Untitled'}</div>
					<div class="draft-meta">
						<span>Saved {new Date(draft.updatedAt).toLocaleString()}</span>
						<button
							class="delete"
							onclick={(e) => {
								e.stopPropagation();
								drafts.remove(draft.id);
							}}
						>
							Delete
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.drafts-page {
		padding: var(--space-xl) 0;
	}
	h1 {
		font-size: 1.25rem;
		font-weight: 600;
		margin-bottom: var(--space-lg);
	}
	.empty {
		color: var(--c-text-secondary);
	}
	.draft-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}
	.draft-item {
		padding: var(--space-md);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.draft-item:hover {
		border-color: var(--c-accent);
	}
	.draft-title {
		font-weight: 500;
		margin-bottom: var(--space-xs);
	}
	.draft-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
		font-size: 0.75rem;
		color: var(--c-text-secondary);
	}
	.delete {
		font-size: 0.75rem;
		padding: 2px 8px;
		color: var(--c-danger);
		border-color: var(--c-danger);
	}

	@media (max-width: 640px) {
		.drafts-page {
			padding: var(--space-lg) 0;
		}
		.draft-meta {
			flex-direction: column;
			align-items: flex-start;
		}
		.delete {
			align-self: flex-start;
		}
	}
</style>
