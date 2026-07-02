<script lang="ts">
	import { tick, untrack } from 'svelte';
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

	// untrack() reads the prop value once without registering a reactive dependency,
	// which is the correct Svelte 5 pattern for initialising editable state from props.
	let title = $state(untrack(() => draft?.title || ''));
	let content = $state(untrack(() => draft?.content || ''));
	let summary = $state(untrack(() => draft?.summary || ''));
	let image = $state(untrack(() => draft?.image || ''));
	let tagInput = $state('');
	let tags = $state<string[]>(untrack(() => draft?.tags || []));
	let showPreview = $state(false);
	let showMeta = $state(false);
	let id = $state(untrack(() => draft?.id || generateId()));
	let publishedAt = $state(untrack(() => draft?.publishedAt));
	let contentTextarea = $state<HTMLTextAreaElement | null>(null);

	let autoSaveTimer: ReturnType<typeof setTimeout>;
	let justSaved = $state(false);

	function flashSaved() {
		justSaved = true;
		setTimeout(() => { justSaved = false; }, 1500);
	}

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
		flashSaved();
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

	async function applyInlineMarkdown(before: string, after = before, placeholder = 'text') {
		const textarea = contentTextarea;
		if (!textarea) return;

		const start = textarea.selectionStart ?? content.length;
		const end = textarea.selectionEnd ?? content.length;
		const selected = content.slice(start, end) || placeholder;

		content = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`;
		autoSave();

		await tick();
		textarea.focus();
		textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
	}

	async function applyBlockMarkdown(prefix: string, placeholder = 'text') {
		const textarea = contentTextarea;
		if (!textarea) return;

		const start = textarea.selectionStart ?? content.length;
		const end = textarea.selectionEnd ?? content.length;
		const lineStart = content.lastIndexOf('\n', start - 1) + 1;
		const lineEnd = end > start ? content.indexOf('\n', end) : content.indexOf('\n', start);
		const safeLineEnd = lineEnd === -1 ? content.length : lineEnd;
		const block = content.slice(lineStart, safeLineEnd) || placeholder;
		const transformed = block
			.split('\n')
			.map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
			.join('\n');

		content = `${content.slice(0, lineStart)}${transformed}${content.slice(safeLineEnd)}`;
		autoSave();

		await tick();
		textarea.focus();
		textarea.setSelectionRange(lineStart + prefix.length, lineStart + transformed.length);
	}

	const markdownActions = [
		{
			label: 'Bold',
			icon: 'B',
			run: () => applyInlineMarkdown('**', '**', 'bold text')
		},
		{
			label: 'Italic',
			icon: 'I',
			run: () => applyInlineMarkdown('*', '*', 'italic text')
		},
		{
			label: 'Link',
			icon: '↗',
			run: () => applyInlineMarkdown('[', '](https://example.com)', 'link text')
		},
		{
			label: 'Code',
			icon: '</>',
			run: () => applyInlineMarkdown('`', '`', 'code')
		},
		{ label: 'H1', icon: 'H1', run: () => applyBlockMarkdown('# ', 'Heading') },
		{ label: 'H2', icon: 'H2', run: () => applyBlockMarkdown('## ', 'Heading') },
		{ label: 'Quote', icon: '❝', run: () => applyBlockMarkdown('> ', 'Quote') },
		{ label: 'List', icon: '•', run: () => applyBlockMarkdown('- ', 'List item') }
	];

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
		<button class="saved" class:just-saved={justSaved} onclick={saveDraft}>{justSaved ? 'Saved ✓' : 'Save Draft'}</button>
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

		{#if !showPreview}
			<div class="markdown-toolbar" aria-label="Markdown formatting tools">
				{#each markdownActions as action}
					<button
						type="button"
						class="markdown-button"
						aria-label={action.label}
						title={action.label}
						onmousedown={(e) => e.preventDefault()}
						onclick={action.run}
					>
						<span class="markdown-icon" aria-hidden="true">{action.icon}</span>
						<span class="markdown-label">{action.label}</span>
					</button>
				{/each}
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
				bind:this={contentTextarea}
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
		flex-wrap: wrap;
	}
	.toolbar button {
		font-size: 0.8125rem;
		padding: var(--space-xs) var(--space-sm);
	}
	.just-saved {
		background: var(--c-accent);
		color: #fff;
		transition: background 0.2s;
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
	.markdown-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
		padding: var(--space-sm);
		background: var(--c-bg);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
	}
	.markdown-button {
		font-size: 0.75rem;
		padding: 2px 8px;
	}
	.markdown-icon {
		display: none;
		font-size: 0.9rem;
		line-height: 1;
		font-weight: 700;
	}
	.markdown-label {
		display: inline;
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
	.preview :global(ul),
	.preview :global(ol) {
		margin: var(--space-md) 0;
		padding-left: 1.5rem;
	}
	.preview :global(li + li) {
		margin-top: 0.25rem;
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

	@media (max-width: 640px) {
		.editor {
			height: auto;
			min-height: calc(100dvh - 48px);
		}
		.editor-body {
			padding: var(--space-md);
			gap: var(--space-sm);
		}
		.toolbar {
			align-items: stretch;
		}
		.toolbar button {
			flex: 1 1 calc(50% - var(--space-sm));
		}
		.markdown-toolbar {
			padding: var(--space-xs);
		}
		.markdown-button {
			flex: 1 1 calc(25% - var(--space-xs));
			justify-content: center;
			padding-inline: 0;
		}
		.markdown-icon {
			display: inline;
		}
		.markdown-label {
			display: none;
		}
		.title-input {
			font-size: 1.25rem;
		}
		.content-input,
		.preview {
			font-size: 1rem;
		}
		.meta-panel {
			padding: var(--space-sm);
		}
	}
</style>
