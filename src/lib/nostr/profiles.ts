import { SimplePool } from 'nostr-tools';
import type { Filter } from 'nostr-tools';

export type NostrProfile = {
	pubkey: string;
	name?: string;
	display_name?: string;
	picture?: string;
	about?: string;
	nip05?: string;
};

const DEFAULT_RELAYS = [
	'wss://relay.damus.io',
	'wss://relay.nostr.band',
	'wss://nos.lol'
];

let pool: SimplePool;
function getPool(): SimplePool {
	if (!pool) pool = new SimplePool();
	return pool;
}

/**
 * Fetch kind-0 profile metadata for a list of pubkeys.
 * Returns a map of pubkey → NostrProfile.
 */
export async function fetchProfiles(
	pubkeys: string[],
	relayUrls: string[] = DEFAULT_RELAYS
): Promise<Map<string, NostrProfile>> {
	if (pubkeys.length === 0) return new Map();

	const filter: Filter = {
		kinds: [0],
		authors: pubkeys
	};

	const p = getPool();
	const events = await p.querySync(relayUrls, filter);

	// For each pubkey keep only the most-recent event
	const latest = new Map<string, (typeof events)[number]>();
	for (const ev of events) {
		const existing = latest.get(ev.pubkey);
		if (!existing || ev.created_at > existing.created_at) {
			latest.set(ev.pubkey, ev);
		}
	}

	const profiles = new Map<string, NostrProfile>();
	for (const [pk, ev] of latest) {
		try {
			const meta = JSON.parse(ev.content) as Record<string, string>;
			profiles.set(pk, {
				pubkey: pk,
				name: meta.name,
				display_name: meta.display_name,
				picture: meta.picture,
				about: meta.about,
				nip05: meta.nip05
			});
		} catch {
			// malformed content – store bare entry
			profiles.set(pk, { pubkey: pk });
		}
	}

	return profiles;
}
