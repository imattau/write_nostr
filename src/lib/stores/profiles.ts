import { writable, get } from 'svelte/store';
import { fetchProfiles, type NostrProfile } from '$lib/nostr/profiles';
import { relays } from '$lib/stores/relays';
import { nip19 } from 'nostr-tools';
import { getProfiles, putProfiles } from '$lib/graph';

// In-memory cache: pubkey → profile (undefined = not yet fetched, null = attempted, no result)
const cache = writable<Map<string, NostrProfile | null>>(new Map());

// Track in-flight requests to avoid duplicate fetches
const pending = new Set<string>();

// Batch profile requests that arrive during the same event loop turn.
const queued = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;
let flushPromiseResolve: (() => void) | null = null;

function scheduleFlush(): Promise<void> {
	if (flushTimer === null) {
		if (!flushPromise) {
			flushPromise = new Promise<void>((resolve) => {
				flushPromiseResolve = resolve;
			});
		}
		flushTimer = setTimeout(() => {
			flushTimer = null;
			void flushQueuedProfiles();
		}, 0);
	}

	return flushPromise ?? Promise.resolve();
}

function finishFlushPromise() {
	if (flushPromiseResolve) {
		flushPromiseResolve();
		flushPromiseResolve = null;
	}
	flushPromise = null;
}

async function flushQueuedProfiles(): Promise<void> {
	if (queued.size === 0) {
		finishFlushPromise();
		return;
	}

	const batch = [...queued];
	queued.clear();

	for (const pk of batch) pending.add(pk);

	try {
		// 1. Check IndexedDB first
		const dbProfiles = await getProfiles(batch);
		if (dbProfiles.size > 0) {
			cache.update((map) => {
				for (const [pk, profile] of dbProfiles) {
					map.set(pk, profile);
					pending.delete(pk);
				}
				return map;
			});
		}

		// 2. Determine which pubkeys still need relay fetch
		const stillMissing = batch.filter((pk) => !dbProfiles.has(pk));
		if (stillMissing.length === 0) return;

		// 3. Fetch from relays if any are configured. If none are available yet
		//    the stillMissing pubkeys stay out of cache so they'll retry later.
		const relayList = get(relays);
		if (relayList.length > 0) {
			const fetched = await fetchProfiles(stillMissing, relayList);

			// 4. Persist resolved profiles to IndexedDB
			if (fetched.size > 0) await putProfiles(fetched);

			// 5. Update in-memory store — set null for pubkeys that returned nothing
			//    so they aren't re-fetched on every request.
			const unresolved = stillMissing.filter((pk) => !fetched.has(pk));
			const nullEntries = new Map(
				unresolved.map((pk) => [pk, null as NostrProfile | null])
			);
			if (nullEntries.size > 0) await putProfiles(nullEntries);

			cache.update((map) => {
				for (const [pk, profile] of fetched) map.set(pk, profile);
				for (const pk of unresolved) map.set(pk, null);
				return map;
			});
		}
	} finally {
		for (const pk of batch) pending.delete(pk);
		if (queued.size > 0) {
			// New requests arrived while this batch was running. Flush them next.
			void flushQueuedProfiles();
			return;
		}
		finishFlushPromise();
	}
}

/**
 * Request profiles for the given pubkeys.
 * Strategy:
 *   1. Return from in-memory store immediately if available.
 *   2. Check IndexedDB for fresh cached profiles.
 *   3. Fetch missing ones from relays and persist to IndexedDB.
 *
 * The `cache` store updates reactively when results arrive.
 */
export async function requestProfiles(pubkeys: string[]): Promise<void> {
	const current = get(cache);
	let scheduled = false;
	for (const pk of pubkeys) {
		if (current.has(pk) || pending.has(pk) || queued.has(pk)) continue;
		queued.add(pk);
		scheduled = true;
	}

	if (!scheduled) return;
	return scheduleFlush();
}

/**
 * Returns the display label for a pubkey.
 * Priority: display_name → name → npub (first 8 + last 4 chars)
 */
export function displayName(pubkey: string, profileMap: { get(key: string): NostrProfile | null | undefined }): string {
	const profile = profileMap.get(pubkey);
	if (profile) {
		if (profile.display_name?.trim()) return profile.display_name.trim();
		if (profile.name?.trim()) return profile.name.trim();
	}

	// Fallback: short npub
	try {
		const npub = nip19.npubEncode(pubkey);
		return npub.slice(0, 8) + '…' + npub.slice(-4);
	} catch {
		return pubkey.slice(0, 8) + '…' + pubkey.slice(-4);
	}
}

export { cache as profileCache };
