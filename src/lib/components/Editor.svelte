<script lang="ts">
	import { renderMarkdown } from '$lib/utils/markdown';
	import { generateId, drafts, type Draft } from '$lib/stores/drafts';

	let {
		draft,
		onPublish
	}: {
		draft?: Draft;
		onPublish?: (opts: {
			title: string;
			content: string;
			summary: string;
			tags: string[];
			image: string;
			identifier: string;
		}) => void;
	} = $props();

	let title = $state(draft?.title || '');
	let content = $state(draft?.content || '');
	let summary = $state(draft?.summary || '');
	let image = $state(draft?.image || '');
	let tagInput = $state('');
	let tags = $state<string[]>(draft?.tags || []);
	let showPreview = $state(false);
	let showMeta = $state(false);
	let id = $state(draft?.id || generateId());
	let publishedAt = $state(draft?.publishedAt);

	let autoSaveTimer: ReturnType<typeof setTimeout>;

	function autoSave() {
		clearTimeout(autoSaveTimer);
		autoSaveTimer = setTimeout(() => {
			drafts.save({
				id,
				title,
				content,
				summary,
				tags,
				image,
				updatedAt: Date.now(),
				publishedAt
			});
		}, 1000);
	}

	function saveDraft() {
		drafts.save({
			id,
			title,
			content,
			summary,
			tags,
			image,
			updatedAt: Date.now(),
			publishedAt
		});
	}

	function addTag() {
		const t = tagInput.trim().toLowerCase();
		if (t && !tags.includes(t)) {
			tags = [...tags, t];
		}
		tagInput = '';
	}

	function removeTag(t: string) {
		tags = tags.filter((x) => x !== t);
	}

	function handlePublish() {
		if (!title.trim() || !content.trim()) return;
		publishedAt = publishedAt || Math.floor(Date.now() / 1000);
		onPublish?.({
			title: title.trim(),
			content: content.trim(),
			summary: summary.trim(),
			tags,
			image: image.trim(),
			identifier: draft?.id || id
		});
	}
</script>

<div class="editor">
	<div class="toolbar">
		<button onclick={() => (showPreview = !showPreview)}>
			{showPreview ? 'Edit' : 'Preview'}
		</button>
		<button onclick={() => (showMeta = !showMeta)}>
			Meta
		</button>
		<button onclick={saveDraft}>Save Draft</button>
		<button class="primary" onclick={handlePublish} disabled={!title.trim() || !content.trim()}>
			Publish
		</button>
	</div>

	<div class="editor-body">
		<input
			class="title-input"
			type="text"
			placeholder="Title"
			bind:value={title}
			oninput={autoSave}
		/>

		{#if showMeta}
			<div class="meta-panel">
				<input
					type="text"
					placeholder="Summary (optional)"
					bind:value={summary}
					oninput={autoSave}
				/>
				<input
					type="url"
					placeholder="Featured image URL (optional)"
					bind:value={image}
					oninput={autoSave}
				/>
				<div class="tags">
					{#each tags as tag}
						<span class="tag">
							{tag}
							<button class="tag-remove" onclick={() => removeTag(tag)}>x</button>
						</span>
					{/each}
					<form
						onsubmit={(e) => { e.preventDefault(); addTag(); }}
						class="tag-form"
					>
						<input
							type="text"
							placeholder="Add tag..."
							bind:value={tagInput}
							size={12}
						/>
					</form>
				</div>
			</div>
		{/if}

		{#if showPreview}
			<div class="preview">
				{@html renderMarkdown(content)}
			</div>
		{:else}
			<textarea
				class="content-input"
				placeholder="Start writing..."
				bind:value={content}
				oninput={autoSave}
			></textarea>
		{/if}
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 48px);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
		border-bottom: 1px solid var(--c-border);
		background: var(--c-surface);
		flex-shrink: 0;
	}
	.toolbar button {
		font-size: 0.8125rem;
		padding: var(--space-xs) var(--space-sm);
	}
	.editor-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: var(--space-lg);
		gap: var(--space-md);
		overflow-y: auto;
		max-width: var(--measure);
		margin: 0 auto;
		width: 100%;
	}
	.title-input {
		font-size: 1.5rem;
		font-weight: 700;
		border: none;
		background: transparent;
		color: var(--c-text);
		outline: none;
		padding: 0;
	}
	.meta-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		padding: var(--space-md);
		background: var(--c-bg);
		border-radius: var(--radius);
	}
	.content-input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--c-text);
		font-size: 1rem;
		line-height: 1.8;
		outline: none;
		resize: none;
		padding: 0;
	}
	.preview {
		flex: 1;
		font-family: var(--font-serif);
		font-size: 1.125rem;
		line-height: 1.8;
		overflow-y: auto;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
		align-items: center;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px 8px;
		background: var(--c-accent);
		color: #fff;
		border-radius: 12px;
		font-size: 0.75rem;
	}
	.tag-remove {
		background: none;
		border: none;
		color: #fff;
		cursor: pointer;
		font-size: 0.75rem;
		padding: 0;
		line-height: 1;
	}
	.tag-form input {
		font-size: 0.75rem;
		padding: 2px 6px;
		border: 1px solid var(--c-border);
		border-radius: 12px;
	}
</style>
