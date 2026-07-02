import { writable, derived, get } from 'svelte/store';
import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';

// ── Internal state ─────────────────────────────────────────────────────────

/** Pubkeys the current user follows (NIP-02 kind:3) */
const followedPubkeys = writable<Set<string>>(new Set());

/** Pubkeys the current user has muted/blocked (NIP-51 kind:10000) */
const blockedPubkeys = writable<Set<string>>(new Set());

let followEventTags: string[][] = []; // full tag list from last kind:3 event
let blockEventTags: string[][] = [];  // full tag list from last kind:10000 event

// ── Public derived stores ──────────────────────────────────────────────────

export const follows = derived(followedPubkeys, ($f) => $f);
export const blocks = derived(blockedPubkeys, ($b) => $b);

// ── Bootstrap: load lists from relays ─────────────────────────────────────

export async function loadSocialLists(): Promise<void> {
	const signer = get(auth);
	if (!signer) return;

	const relayList = get(relays);
	const pool = new SimplePool();

	try {
		const events = await pool.querySync(relayList, {
			kinds: [3, 10000],
			authors: [signer.pubkey],
			limit: 2
		});

		// kind:3 – contact list (follows)
		const followEvent = events
			.filter((e) => e.kind === 3)
			.sort((a, b) => b.created_at - a.created_at)[0];

		if (followEvent) {
			followEventTags = followEvent.tags;
			followedPubkeys.set(
				new Set(
					followEvent.tags.filter(([k]) => k === 'p').map(([, pk]) => pk)
				)
			);
		}

		// kind:10000 – mute/block list
		const blockEvent = events
			.filter((e) => e.kind === 10000)
			.sort((a, b) => b.created_at - a.created_at)[0];

		if (blockEvent) {
			blockEventTags = blockEvent.tags;
			blockedPubkeys.set(
				new Set(
					blockEvent.tags.filter(([k]) => k === 'p').map(([, pk]) => pk)
				)
			);
		}
	} finally {
		pool.destroy();
	}
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
	await publishList(3, newTags);
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
	await publishList(3, newTags);
}

// ── Block ──────────────────────────────────────────────────────────────────

export async function blockUser(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	// Optimistic update
	blockedPubkeys.update((s) => new Set([...s, pubkey]));

	const existingPTags = blockEventTags.filter(([k]) => k === 'p');
	const alreadyPresent = existingPTags.some(([, pk]) => pk === pubkey);
	const newPTag: string[] = ['p', pubkey];
	const newTags = alreadyPresent
		? blockEventTags
		: [
				...blockEventTags.filter(([k]) => k !== 'p'),
				...existingPTags,
				newPTag
			];

	blockEventTags = newTags;
	await publishList(10000, newTags);
}

export async function unblockUser(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	// Optimistic update
	blockedPubkeys.update((s) => {
		const next = new Set(s);
		next.delete(pubkey);
		return next;
	});

	const newTags = blockEventTags.filter(([k, pk]) => !(k === 'p' && pk === pubkey));
	blockEventTags = newTags;
	await publishList(10000, newTags);
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function publishList(kind: 3 | 10000, tags: string[][]): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const event: NostrEvent = {
		kind,
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
