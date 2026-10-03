import { SimplePool, verifyEvent } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import type { Signer } from '$lib/stores/auth';
import { encryptPrivateTags, decryptPrivateTags } from './listCrypto';

export type ListEntry = { tag: string[]; private: boolean };

export type ListSpec = {
	kind: number;
	/** Required for parameterized-replaceable lists (e.g. kind 30000). */
	dTag?: string;
};

const pendingSaves = new Map<string, Promise<void>>();
const lastCreatedAt = new Map<string, number>();

function localListKey(pubkey: string, spec: ListSpec): string {
	return `write_nip51_${pubkey}_${spec.kind}_${spec.dTag ?? ''}`;
}

function readCachedEvent(signer: Signer, spec: ListSpec): NostrEvent | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const parsed = JSON.parse(localStorage.getItem(localListKey(signer.pubkey, spec)) || 'null') as NostrEvent | null;
		if (!parsed || parsed.pubkey !== signer.pubkey || parsed.kind !== spec.kind || !verifyEvent(parsed)) return null;
		if (spec.dTag !== undefined && !parsed.tags.some(([key, value]) => key === 'd' && value === spec.dTag)) return null;
		return parsed;
	} catch {
		return null;
	}
}

/** Returns verified cached events for a list kind, including parameterized list names. */
export function readCachedListEvents(signer: Signer, kind: number): NostrEvent[] {
	if (typeof localStorage === 'undefined') return [];
	const prefix = `write_nip51_${signer.pubkey}_${kind}_`;
	const events: NostrEvent[] = [];
	for (let index = 0; index < localStorage.length; index++) {
		const key = localStorage.key(index);
		if (!key?.startsWith(prefix)) continue;
		try {
			const event = JSON.parse(localStorage.getItem(key) || 'null') as NostrEvent | null;
			if (!event || event.pubkey !== signer.pubkey || event.kind !== kind || !verifyEvent(event)) continue;
			const dTag = event.tags.find(([tag]) => tag === 'd')?.[1];
			if (dTag !== key.slice(prefix.length)) continue;
			events.push(event);
		} catch {
			// Ignore corrupt cache entries and continue with relay data.
		}
	}
	return events;
}

export function removeCachedListEvent(pubkey: string, spec: ListSpec): void {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(localListKey(pubkey, spec));
}

function cacheEvent(pubkey: string, spec: ListSpec, event: NostrEvent): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(localListKey(pubkey, spec), JSON.stringify(event));
	} catch {
		// Relay state remains the source of truth if local storage is unavailable.
	}
}

/** Pure: merges decrypted public/private tag arrays into one ordered ListEntry[] (public first). */
export function tagsToEntries(publicTags: string[][], privateTags: string[][]): ListEntry[] {
	return [
		...publicTags.map((tag) => ({ tag, private: false as const })),
		...privateTags.map((tag) => ({ tag, private: true as const }))
	];
}

/** Pure: splits entries into public/private tag arrays, prepending a d tag to public tags if given. */
export function entriesToTags(
	entries: ListEntry[],
	dTag?: string
): { publicTags: string[][]; privateTags: string[][] } {
	const publicTags = entries.filter((e) => !e.private).map((e) => e.tag);
	const privateTags = entries.filter((e) => e.private).map((e) => e.tag);
	return {
		publicTags: dTag !== undefined ? [['d', dTag], ...publicTags] : publicTags,
		privateTags
	};
}

/** Fetches a NIP-51 list event for the signer's own pubkey and merges its public+private tags. */
export async function loadList(
	signer: Signer,
	relayList: string[],
	spec: ListSpec
): Promise<ListEntry[]> {
	const pool = new SimplePool();
	try {
		const cachedEvent = readCachedEvent(signer, spec);
		const filter: Record<string, unknown> = {
			kinds: [spec.kind],
			authors: [signer.pubkey],
			limit: 1
		};
		if (spec.dTag !== undefined) filter['#d'] = [spec.dTag];

		let events: NostrEvent[] = [];
		try {
			events = await pool.querySync(relayList, filter as Parameters<typeof pool.querySync>[1]);
		} catch (error) {
			if (!cachedEvent) throw error;
		}
		const relayEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
		const event = cachedEvent && (!relayEvent || cachedEvent.created_at >= relayEvent.created_at) ? cachedEvent : relayEvent;
		if (!event) return [];
		if (event === relayEvent) cacheEvent(signer.pubkey, spec, event);

		const publicTags = event.tags.filter(([key]) => key !== 'd');
		const privateTags = await decryptPrivateTags(signer, event.content);
		return tagsToEntries(publicTags, privateTags);
	} finally {
		pool.destroy();
	}
}

/** Builds, signs, and publishes a NIP-51 list event from a full entry set (replaces the whole list). */
async function saveListOnce(
	signer: Signer,
	relayList: string[],
	spec: ListSpec,
	entries: ListEntry[]
): Promise<void> {
	const key = localListKey(signer.pubkey, spec);
	const { publicTags, privateTags } = entriesToTags(entries, spec.dTag);
	const content = await encryptPrivateTags(signer, privateTags);
	const cached = readCachedEvent(signer, spec);
	const createdAt = Math.max(
		Math.floor(Date.now() / 1000),
		(lastCreatedAt.get(key) ?? cached?.created_at ?? 0) + 1
	);

	const event: NostrEvent = {
		kind: spec.kind,
		created_at: createdAt,
		tags: publicTags,
		content,
		pubkey: signer.pubkey
	} as NostrEvent;

	const signed = await signer.sign(event);
	const pool = new SimplePool();
	try {
		const results = await Promise.allSettled(pool.publish(relayList, signed));
		if (!results.some((result) => result.status === 'fulfilled')) {
			throw new Error('Could not publish the list to any relay. Check your relay connection and try again.');
		}
		cacheEvent(signer.pubkey, spec, signed);
		lastCreatedAt.set(key, createdAt);
	} finally {
		pool.destroy();
	}
}

/** Serialize full-list replacements per account/list so overlapping edits cannot publish stale snapshots out of order. */
export async function saveList(
	signer: Signer,
	relayList: string[],
	spec: ListSpec,
	entries: ListEntry[]
): Promise<void> {
	const key = localListKey(signer.pubkey, spec);
	const previous = pendingSaves.get(key) ?? Promise.resolve();
	const task = previous.catch(() => {}).then(() => saveListOnce(signer, relayList, spec, entries));
	pendingSaves.set(key, task);
	try {
		await task;
	} finally {
		if (pendingSaves.get(key) === task) pendingSaves.delete(key);
	}
}
