import { writable, get } from 'svelte/store';
import { fetchProfiles, type NostrProfile } from '$lib/nostr/profiles';
import { relays } from '$lib/stores/relays';
import { nip19 } from 'nostr-tools';
import { getProfiles, putProfiles } from '$lib/db';

// In-memory cache: pubkey → profile (undefined = not yet fetched, null = attempted, no result)
const cache = writable<Map<string, NostrProfile | null>>(new Map());

// Track in-flight requests to avoid duplicate fetches
const pending = new Set<string>();

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
	const needFetch = pubkeys.filter((pk) => !current.has(pk) && !pending.has(pk));
	if (needFetch.length === 0) return;

	for (const pk of needFetch) pending.add(pk);

	try {
		// 1. Check IndexedDB first
		const dbProfiles = await getProfiles(needFetch);
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
		const stillMissing = needFetch.filter((pk) => !dbProfiles.has(pk));
		if (stillMissing.length === 0) return;

		// 3. Fetch from relay
		const relayList = get(relays);
		const fetched = await fetchProfiles(stillMissing, relayList);

		// 4. Persist to IndexedDB
		if (fetched.size > 0) await putProfiles(fetched);

		// 5. Update in-memory store
		cache.update((map) => {
			for (const pk of stillMissing) {
				map.set(pk, fetched.get(pk) ?? null);
			}
			return map;
		});
	} finally {
		for (const pk of needFetch) pending.delete(pk);
	}
}

/**
 * Returns the display label for a pubkey.
 * Priority: display_name → name → npub (first 8 + last 4 chars)
 */
export function displayName(pubkey: string, profileMap: Map<string, NostrProfile | null>): string {
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
