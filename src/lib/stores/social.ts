import { writable, derived, get } from 'svelte/store';
import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { loadList, saveList, type ListEntry } from '$lib/nostr/lists';
import { removeNodesByPubkey } from '$lib/graph';

// ── Internal state ─────────────────────────────────────────────────────────

/** Pubkeys the current user follows (NIP-02 kind:3) */
const followedPubkeys = writable<Set<string>>(new Set());

/** NIP-51 mute-list entries (kind:10000), public + private, as loaded from relays */
const blockedListEntries = writable<ListEntry[]>([]);

let followEventTags: string[][] = []; // full tag list from last kind:3 event

// ── Public derived stores ──────────────────────────────────────────────────

export const follows = derived(followedPubkeys, ($f) => $f);

/** All muted pubkeys (public + private) as a Set, for quick membership checks. */
export const blocks = derived(blockedListEntries, ($entries) => new Set($entries.map((e) => e.tag[1])));

/** Mute-list entries with their privacy flag, for list-management UI. */
export const blockedEntries = derived(blockedListEntries, ($e) => $e);

// ── Bootstrap: load lists from relays ─────────────────────────────────────

export async function loadSocialLists(): Promise<void> {
	const signer = get(auth);
	if (!signer) return;

	const relayList = get(relays);
	const pool = new SimplePool();

	try {
		const events = await pool.querySync(relayList, {
			kinds: [3],
			authors: [signer.pubkey],
			limit: 1
		});

		// kind:3 – contact list (follows)
		const followEvent = events.sort((a, b) => b.created_at - a.created_at)[0];

		if (followEvent) {
			followEventTags = followEvent.tags;
			followedPubkeys.set(
				new Set(
					followEvent.tags.filter(([k]) => k === 'p').map(([, pk]) => pk)
				)
			);
		}
	} finally {
		pool.destroy();
	}

	// kind:10000 – mute/block list (public + private)
	const entries = await loadList(signer, relayList, { kind: 10000 });
	blockedListEntries.set(entries);
}

// ── Follow ─────────────────────────────────────────────────────────────────

export async function followUser(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	// Optimistic update
	followedPubkeys.update((s) => new Set([...s, pubkey]));

	// Build new tag list (keep existing non-p tags + existing follows + new one)
	const existingPTags = followEventTags.filter(([k]) => k === 'p');
	const alreadyPresent = existingPTags.some(([, pk]) => pk === pubkey);
	const newPTag: string[] = ['p', pubkey];
	const newTags = alreadyPresent
		? followEventTags
		: [
				...followEventTags.filter(([k]) => k !== 'p'),
				...existingPTags,
				newPTag
			];

	followEventTags = newTags;
	await publishFollowList(newTags);
}

export async function unfollowUser(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	// Optimistic update
	followedPubkeys.update((s) => {
		const next = new Set(s);
		next.delete(pubkey);
		return next;
	});

	const newTags = followEventTags.filter(([k, pk]) => !(k === 'p' && pk === pubkey));
	followEventTags = newTags;
	await publishFollowList(newTags);
}

// ── Block ──────────────────────────────────────────────────────────────────

export async function blockUser(pubkey: string, opts: { private?: boolean } = {}): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const isPrivate = opts.private ?? false;

	// Optimistic update
	blockedListEntries.update((entries) => {
		if (entries.some((e) => e.tag[1] === pubkey)) return entries;
		return [...entries, { tag: ['p', pubkey], private: isPrivate }];
	});

	// Purge cached events and profile for the blocked user
	removeNodesByPubkey(pubkey).catch(() => {});

	const newEntries = get(blockedListEntries);
	await saveList(signer, get(relays), { kind: 10000 }, newEntries);
}

export async function unblockUser(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	// Optimistic update
	blockedListEntries.update((entries) => entries.filter((e) => e.tag[1] !== pubkey));

	const newEntries = get(blockedListEntries);
	await saveList(signer, get(relays), { kind: 10000 }, newEntries);
}

/** Sets an existing mute-list entry's privacy flag and republishes the list. Used by the Lists page. */
export async function setBlockedEntryPrivacy(pubkey: string, isPrivate: boolean): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	blockedListEntries.update((entries) =>
		entries.map((e) => (e.tag[1] === pubkey ? { ...e, private: isPrivate } : e))
	);

	const newEntries = get(blockedListEntries);
	await saveList(signer, get(relays), { kind: 10000 }, newEntries);
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function publishFollowList(tags: string[][]): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const event: NostrEvent = {
		kind: 3,
		created_at: Math.floor(Date.now() / 1000),
		tags,
		content: '',
		pubkey: signer.pubkey
	} as NostrEvent;

	const signed = await signer.sign(event);
	const relayList = get(relays);
	const pool = new SimplePool();
	try {
		await Promise.allSettled(pool.publish(relayList, signed));
	} finally {
		pool.destroy();
	}
}
