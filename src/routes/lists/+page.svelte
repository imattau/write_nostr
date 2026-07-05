<script lang="ts">
	import { auth, pubkey as myPubkey } from '$lib/stores/auth';
	import { relays } from '$lib/stores/relays';
	import { profileCache, requestProfiles, displayName } from '$lib/stores/profiles';
	import { encodeNaddr } from '$lib/utils/nip19';
	import { fetchArticleByIdentifier } from '$lib/nostr/fetch';

	import {
		blockedEntries,
		unblockUser,
		setBlockedEntryPrivacy,
		loadSocialLists
	} from '$lib/stores/social';
	import {
		bookmarkEntries,
		removeBookmark,
		setBookmarkEntryPrivacy,
		loadBookmarks
	} from '$lib/stores/bookmarks';
	import {
		pinEntries,
		removePin,
		setPinEntryPrivacy,
		loadPins
	} from '$lib/stores/pins';
	import {
		categorizedLists,
		loadCategorizedLists,
		createCategorizedList,
		renameCategorizedList,
		deleteCategorizedList,
		addPersonToList,
		removePersonFromList,
		setListEntryPrivacy
	} from '$lib/stores/categorizedLists';

	// ── Crypto capability check ────────────────────────────────────────────

	let hasCrypto = $derived(!!($auth?.nip44 || $auth?.nip04));

	// ── Article title resolution ───────────────────────────────────────────

	/** coordinate ("30023:pubkey:identifier") → resolved title, or null if not found/pending */
	let articleTitles = $state<Map<string, string | null>>(new Map());
	const inFlightArticles = new Set<string>();

	function parseCoordinate(coordinate: string): { kind: number; pubkey: string; identifier: string } | null {
		const parts = coordinate.split(':');
		if (parts.length < 3) return null;
		const kind = Number(parts[0]);
		if (Number.isNaN(kind)) return null;
		const pubkey = parts[1];
		const identifier = parts.slice(2).join(':');
		return { kind, pubkey, identifier };
	}

	async function resolveArticleTitle(coordinate: string): Promise<void> {
		if (articleTitles.has(coordinate) || inFlightArticles.has(coordinate)) return;
		const parsed = parseCoordinate(coordinate);
		if (!parsed) {
			articleTitles.set(coordinate, null);
			articleTitles = new Map(articleTitles);
			return;
		}
		inFlightArticles.add(coordinate);
		try {
			const event = await fetchArticleByIdentifier(parsed.pubkey, parsed.identifier, $relays);
			const title = event?.tags.find(([k]) => k === 'title')?.[1] ?? null;
			articleTitles.set(coordinate, title);
			articleTitles = new Map(articleTitles);
		} catch {
			articleTitles.set(coordinate, null);
			articleTitles = new Map(articleTitles);
		} finally {
			inFlightArticles.delete(coordinate);
		}
	}

	function articleLabel(coordinate: string): string {
		const title = articleTitles.get(coordinate);
		if (title) return title;
		return coordinate;
	}

	function articleHref(coordinate: string): string | null {
		const parsed = parseCoordinate(coordinate);
		if (!parsed) return null;
		try {
			return `/article/${encodeNaddr(parsed.pubkey, parsed.identifier)}`;
		} catch {
			return null;
		}
	}

	$effect(() => {
		for (const e of $bookmarkEntries) void resolveArticleTitle(e.tag[1]);
		for (const e of $pinEntries) void resolveArticleTitle(e.tag[1]);
	});

	// ── Profile resolution for muted / categorized-list pubkeys ────────────

	$effect(() => {
		$profileCache;
		if ($relays.length === 0) return;
		const pubkeys = new Set<string>();
		for (const e of $blockedEntries) pubkeys.add(e.tag[1]);
		for (const list of $categorizedLists) {
			for (const e of list.entries) pubkeys.add(e.tag[1]);
		}
		if (pubkeys.size > 0) requestProfiles([...pubkeys]);
	});

	// ── Load everything on mount ────────────────────────────────────────────

	$effect(() => {
		if ($myPubkey) {
			loadSocialLists();
			loadBookmarks();
			loadPins();
			loadCategorizedLists();
		}
	});

	// ── Categorized lists UI state ──────────────────────────────────────────

	let newListName = $state('');
	let renamingList = $state<string | null>(null);
	let renameValue = $state('');
	let addMemberInputs = $state<Record<string, string>>({});
	let addMemberPrivate = $state<Record<string, boolean>>({});
	let message = $state('');

	function showMessage(msg: string) {
		message = msg;
		setTimeout(() => {
			if (message === msg) message = '';
		}, 3000);
	}

	async function handleCreateList() {
		const name = newListName.trim();
		if (!name) return;
		try {
			await createCategorizedList(name);
			newListName = '';
		} catch (e: any) {
			showMessage(e?.message || 'Failed to create list');
		}
	}

	function startRename(name: string) {
		renamingList = name;
		renameValue = name;
	}

	async function confirmRename() {
		if (!renamingList) return;
		const newName = renameValue.trim();
		if (!newName || newName === renamingList) {
			renamingList = null;
			return;
		}
		try {
			await renameCategorizedList(renamingList, newName);
		} catch (e: any) {
			showMessage(e?.message || 'Failed to rename list');
		} finally {
			renamingList = null;
		}
	}

	async function handleDeleteList(name: string) {
		try {
			await deleteCategorizedList(name);
		} catch (e: any) {
			showMessage(e?.message || 'Failed to delete list');
		}
	}

	async function handleAddMember(listName: string) {
		const input = (addMemberInputs[listName] || '').trim();
		if (!input) return;
		try {
			const { nip19 } = await import('nostr-tools');
			let pk = input;
			if (input.startsWith('npub1')) {
				const decoded = nip19.decode(input);
				if (decoded.type !== 'npub') throw new Error('Invalid npub');
				pk = decoded.data as string;
			}
			await addPersonToList(listName, pk, { private: !!addMemberPrivate[listName] });
			addMemberInputs[listName] = '';
		} catch (e: any) {
			showMessage(e?.message || 'Failed to add member');
		}
	}
</script>

<div class="lists-page">
	<h1>Lists</h1>
	<p class="desc">
		Manage your NIP-51 lists: muted users, bookmarks, pins, and custom categorized people lists.
	</p>

	{#if !hasCrypto}
		<p class="crypto-warning" title="Your signer does not support NIP-04 or NIP-44 encryption, so private list entries cannot be created or read.">
			⚠ Your signer doesn't support encryption. Private-entry toggles are disabled — new entries will be public only.
		</p>
	{/if}

	<!-- Mute list -->
	<section>
		<h2>Muted users</h2>
		{#if $blockedEntries.length === 0}
			<p class="empty">No muted users.</p>
		{:else}
			<div class="entry-list">
				{#each $blockedEntries as entry (entry.tag[1])}
					<div class="entry">
						<span class="entry-label">{displayName(entry.tag[1], $profileCache)}</span>
						<label class="private-toggle" title={hasCrypto ? 'Toggle private (encrypted)' : 'Encryption not supported by signer'}>
							<input
								type="checkbox"
								checked={entry.private}
								disabled={!hasCrypto}
								onchange={(e) => setBlockedEntryPrivacy(entry.tag[1], (e.target as HTMLInputElement).checked)}
							/>
							Private
						</label>
						<button class="remove" onclick={() => unblockUser(entry.tag[1])}>Remove</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Bookmarks -->
	<section>
		<h2>Bookmarks</h2>
		{#if $bookmarkEntries.length === 0}
			<p class="empty">No bookmarked articles.</p>
		{:else}
			<div class="entry-list">
				{#each $bookmarkEntries as entry (entry.tag[1])}
					{@const href = articleHref(entry.tag[1])}
					<div class="entry">
						{#if href}
							<a class="entry-label" {href}>{articleLabel(entry.tag[1])}</a>
						{:else}
							<span class="entry-label">{articleLabel(entry.tag[1])}</span>
						{/if}
						<label class="private-toggle" title={hasCrypto ? 'Toggle private (encrypted)' : 'Encryption not supported by signer'}>
							<input
								type="checkbox"
								checked={entry.private}
								disabled={!hasCrypto}
								onchange={(e) => setBookmarkEntryPrivacy(entry.tag[1], (e.target as HTMLInputElement).checked)}
							/>
							Private
						</label>
						<button class="remove" onclick={() => removeBookmark(entry.tag[1])}>Remove</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Pins -->
	<section>
		<h2>Pins</h2>
		{#if $pinEntries.length === 0}
			<p class="empty">No pinned articles.</p>
		{:else}
			<div class="entry-list">
				{#each $pinEntries as entry (entry.tag[1])}
					{@const href = articleHref(entry.tag[1])}
					<div class="entry">
						{#if href}
							<a class="entry-label" {href}>{articleLabel(entry.tag[1])}</a>
						{:else}
							<span class="entry-label">{articleLabel(entry.tag[1])}</span>
						{/if}
						<label class="private-toggle" title={hasCrypto ? 'Toggle private (encrypted)' : 'Encryption not supported by signer'}>
							<input
								type="checkbox"
								checked={entry.private}
								disabled={!hasCrypto}
								onchange={(e) => setPinEntryPrivacy(entry.tag[1], (e.target as HTMLInputElement).checked)}
							/>
							Private
						</label>
						<button class="remove" onclick={() => removePin(entry.tag[1])}>Remove</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Categorized lists -->
	<section>
		<h2>Categorized lists</h2>
		<p class="desc">Custom people lists (NIP-51 kind:30000), e.g. "Close friends" or "Writers to follow".</p>

		<form class="new-list" onsubmit={(e) => { e.preventDefault(); handleCreateList(); }}>
			<input type="text" placeholder="New list name" bind:value={newListName} />
			<button type="submit" disabled={!newListName.trim()}>Create list</button>
		</form>

		{#if $categorizedLists.length === 0}
			<p class="empty">No categorized lists yet.</p>
		{:else}
			<div class="category-lists">
				{#each $categorizedLists as list (list.name)}
					<div class="category-list">
						<div class="category-list-header">
							{#if renamingList === list.name}
								<form onsubmit={(e) => { e.preventDefault(); confirmRename(); }} class="rename-form">
									<input type="text" bind:value={renameValue} />
									<button type="submit">Save</button>
									<button type="button" onclick={() => (renamingList = null)}>Cancel</button>
								</form>
							{:else}
								<h3>{list.name}</h3>
								<div class="category-list-actions">
									<button onclick={() => startRename(list.name)}>Rename</button>
									<button class="remove" onclick={() => handleDeleteList(list.name)}>Delete list</button>
								</div>
							{/if}
						</div>

						{#if list.entries.length === 0}
							<p class="empty">No members yet.</p>
						{:else}
							<div class="entry-list">
								{#each list.entries as entry (entry.tag[1])}
									<div class="entry">
										<span class="entry-label">{displayName(entry.tag[1], $profileCache)}</span>
										<label class="private-toggle" title={hasCrypto ? 'Toggle private (encrypted)' : 'Encryption not supported by signer'}>
											<input
												type="checkbox"
												checked={entry.private}
												disabled={!hasCrypto}
												onchange={(e) => setListEntryPrivacy(list.name, entry.tag[1], (e.target as HTMLInputElement).checked)}
											/>
											Private
										</label>
										<button class="remove" onclick={() => removePersonFromList(list.name, entry.tag[1])}>Remove</button>
									</div>
								{/each}
							</div>
						{/if}

						<form
							class="add-member"
							onsubmit={(e) => { e.preventDefault(); handleAddMember(list.name); }}
						>
							<input
								type="text"
								placeholder="npub or hex pubkey"
								value={addMemberInputs[list.name] || ''}
								oninput={(e) => (addMemberInputs[list.name] = (e.target as HTMLInputElement).value)}
							/>
							<label class="private-toggle" title={hasCrypto ? 'Add as private (encrypted)' : 'Encryption not supported by signer'}>
								<input
									type="checkbox"
									checked={!!addMemberPrivate[list.name]}
									disabled={!hasCrypto}
									onchange={(e) => (addMemberPrivate[list.name] = (e.target as HTMLInputElement).checked)}
								/>
								Private
							</label>
							<button type="submit" disabled={!(addMemberInputs[list.name] || '').trim()}>Add</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if message}
		<p class="toast">{message}</p>
	{/if}
</div>

<style>
	.lists-page {
		padding: var(--space-xl) 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2xl);
		max-width: var(--measure);
		margin: 0 auto;
	}
	h1 {
		font-size: 1.25rem;
		font-weight: 600;
	}
	h2 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: var(--space-sm);
	}
	h3 {
		font-size: 0.9375rem;
		font-weight: 600;
	}
	.desc {
		font-size: 0.875rem;
		color: var(--c-text-secondary);
		margin-bottom: var(--space-md);
	}
	.crypto-warning {
		font-size: 0.8125rem;
		color: var(--c-danger);
		background: var(--c-surface);
		border: 1px solid var(--c-danger);
		border-radius: var(--radius);
		padding: var(--space-sm) var(--space-md);
	}
	section {
		padding-bottom: var(--space-lg);
		border-bottom: 1px solid var(--c-border);
	}
	.empty {
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
	}
	.entry-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		margin-bottom: var(--space-md);
	}
	.entry {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		padding: var(--space-sm) var(--space-md);
		background: var(--c-bg);
		border-radius: var(--radius);
	}
	.entry-label {
		flex: 1;
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.private-toggle {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		color: var(--c-text-secondary);
		white-space: nowrap;
	}
	.remove {
		font-size: 0.75rem;
		padding: 2px 8px;
		color: var(--c-danger);
		border-color: var(--c-danger);
	}
	.new-list {
		display: flex;
		gap: var(--space-sm);
		margin-bottom: var(--space-md);
	}
	.new-list input {
		flex: 1;
	}
	.category-lists {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}
	.category-list {
		padding: var(--space-md);
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
	}
	.category-list-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-sm);
		gap: var(--space-sm);
	}
	.category-list-actions {
		display: flex;
		gap: var(--space-sm);
	}
	.rename-form {
		display: flex;
		gap: var(--space-sm);
		flex: 1;
	}
	.rename-form input {
		flex: 1;
	}
	.add-member {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-top: var(--space-sm);
	}
	.add-member input {
		flex: 1;
	}
	.toast {
		position: fixed;
		bottom: var(--space-md);
		left: 50%;
		transform: translateX(-50%);
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius);
		font-size: 0.875rem;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
	}

	@media (max-width: 640px) {
		.lists-page {
			padding: var(--space-lg) 0;
			gap: var(--space-xl);
		}
		.entry {
			flex-wrap: wrap;
		}
		.new-list,
		.add-member {
			flex-direction: column;
			align-items: stretch;
		}
		.category-list-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
