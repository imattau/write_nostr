import { writable, derived, get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { loadList, saveList, type ListEntry } from '$lib/nostr/lists';

const BOOKMARKS_KIND = 10003;
const bookmarkListEntries = writable<ListEntry[]>([]);

export const bookmarkEntries = derived(bookmarkListEntries, ($e) => $e);
export const bookmarkedCoordinates = derived(
	bookmarkListEntries,
	($entries) => new Set($entries.map((e) => e.tag[1]))
);

export async function loadBookmarks(): Promise<void> {
	const signer = get(auth);
	if (!signer) return;
	const entries = await loadList(signer, get(relays), { kind: BOOKMARKS_KIND });
	bookmarkListEntries.set(entries);
}

export async function addBookmark(coordinate: string, opts: { private?: boolean } = {}): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');
	const isPrivate = opts.private ?? false;
	bookmarkListEntries.update((entries) => {
		if (entries.some((e) => e.tag[1] === coordinate)) return entries;
		return [...entries, { tag: ['a', coordinate], private: isPrivate }];
	});
	await saveList(signer, get(relays), { kind: BOOKMARKS_KIND }, get(bookmarkListEntries));
}

export async function removeBookmark(coordinate: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');
	bookmarkListEntries.update((entries) => entries.filter((e) => e.tag[1] !== coordinate));
	await saveList(signer, get(relays), { kind: BOOKMARKS_KIND }, get(bookmarkListEntries));
}

export async function setBookmarkEntryPrivacy(coordinate: string, isPrivate: boolean): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');
	bookmarkListEntries.update((entries) =>
		entries.map((e) => (e.tag[1] === coordinate ? { ...e, private: isPrivate } : e))
	);
	await saveList(signer, get(relays), { kind: BOOKMARKS_KIND }, get(bookmarkListEntries));
}
