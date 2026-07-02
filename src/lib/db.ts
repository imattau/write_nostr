/**
 * db.ts — IndexedDB caching layer for write_nostr
 *
 * Stores:
 *   events   – Nostr events (kind 30023 articles, kind 3 follow lists, etc.)
 *   profiles – Parsed kind-0 profile metadata
 *
 * TTLs:
 *   Articles  (kind 30023)  → 1 hour
 *   Follow list (kind 3)    → 30 minutes
 *   Profiles  (kind 0)      → 1 hour
 *   Relay list (kind 10002) → 1 hour
 *
 * All TTLs are enforced at read time — stale records are treated as a miss
 * and the caller is responsible for re-fetching from the relay.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { NostrEvent } from 'nostr-tools';
import type { NostrProfile } from '$lib/nostr/profiles';

// ---------------------------------------------------------------------------
// TTL constants (milliseconds)
// ---------------------------------------------------------------------------
export const TTL = {
	articles: 60 * 60 * 1000,       // 1 hour
	followList: 30 * 60 * 1000,     // 30 minutes
	profiles: 60 * 60 * 1000,       // 1 hour
	relayList: 60 * 60 * 1000       // 1 hour
} as const;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
interface CachedEvent {
	/** The Nostr event id */
	id: string;
	/** The full event */
	event: NostrEvent;
	/** Epoch ms when this record was stored */
	cachedAt: number;
	/**
	 * Lookup key used to retrieve a group of events.
	 * Examples:
	 *   articles-all           → all articles feed
	 *   articles-author-<npub> → per-author article set
	 *   followlist-<pubkey>    → a user's follow list event
	 *   relaylist-<pubkey>     → a user's relay list event
	 */
	groupKey: string;
}

interface CachedProfile {
	pubkey: string;
	profile: NostrProfile | null;
	cachedAt: number;
}

interface NostrDBSchema extends DBSchema {
	events: {
		key: string;
		value: CachedEvent;
		indexes: { byGroupKey: string; byKind: number };
	};
	profiles: {
		key: string;
		value: CachedProfile;
	};
}

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------
const DB_NAME = 'write-nostr-cache';
const DB_VERSION = 1;

let _db: IDBPDatabase<NostrDBSchema> | null = null;

async function getDB(): Promise<IDBPDatabase<NostrDBSchema>> {
	if (_db) return _db;

	_db = await openDB<NostrDBSchema>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			// Events store
			if (!db.objectStoreNames.contains('events')) {
				const evStore = db.createObjectStore('events', { keyPath: 'id' });
				evStore.createIndex('byGroupKey', 'groupKey');
				evStore.createIndex('byKind', ['event.kind'] as unknown as string);
			}
			// Profiles store
			if (!db.objectStoreNames.contains('profiles')) {
				db.createObjectStore('profiles', { keyPath: 'pubkey' });
			}
		}
	});

	return _db;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isStale(cachedAt: number, ttl: number): boolean {
	return Date.now() - cachedAt > ttl;
}

// ---------------------------------------------------------------------------
// Events API
// ---------------------------------------------------------------------------

/**
 * Store a batch of events under a group key.
 * Existing records for the same id are overwritten (upsert).
 */
export async function putEvents(events: NostrEvent[], groupKey: string): Promise<void> {
	if (typeof window === 'undefined') return; // SSR guard
	const db = await getDB();
	const tx = db.transaction('events', 'readwrite');
	const now = Date.now();
	await Promise.all(
		events.map((event) =>
			tx.store.put({ id: event.id, event, cachedAt: now, groupKey })
		)
	);
	await tx.done;
}

/**
 * Retrieve all events for a group key that are not older than `ttl` ms.
 * Returns null if nothing is cached or if *any* record is stale
 * (so the caller fetches a fresh, consistent batch).
 */
export async function getEvents(
	groupKey: string,
	ttl: number
): Promise<NostrEvent[] | null> {
	if (typeof window === 'undefined') return null; // SSR guard
	const db = await getDB();
	const records = await db.getAllFromIndex('events', 'byGroupKey', groupKey);
	if (!records.length) return null;

	// Check for staleness on the oldest record in the group
	const oldestCachedAt = Math.min(...records.map((r) => r.cachedAt));
	if (isStale(oldestCachedAt, ttl)) return null;

	return records.map((r) => r.event);
}

/**
 * Retrieve a single event by id, with optional TTL check.
 */
export async function getEvent(
	id: string,
	ttl?: number
): Promise<NostrEvent | null> {
	if (typeof window === 'undefined') return null;
	const db = await getDB();
	const record = await db.get('events', id);
	if (!record) return null;
	if (ttl !== undefined && isStale(record.cachedAt, ttl)) return null;
	return record.event;
}

/**
 * Retrieve all cached events of a given kind that are not stale.
 * Useful for sweeping the cache across group keys (e.g. all articles).
 */
export async function getAllEventsByKind(
	kind: number,
	ttl: number
): Promise<NostrEvent[]> {
	if (typeof window === 'undefined') return [];
	const db = await getDB();
	const records = await db.getAllFromIndex('events', 'byKind', kind);
	if (!records.length) return [];
	return records
		.filter((r) => !isStale(r.cachedAt, ttl))
		.map((r) => r.event);
}

// ---------------------------------------------------------------------------
// Profiles API
// ---------------------------------------------------------------------------

/**
 * Store a map of pubkey → profile (null = pubkey has no kind-0 event).
 */
export async function putProfiles(profiles: Map<string, NostrProfile | null>): Promise<void> {
	if (typeof window === 'undefined') return;
	const db = await getDB();
	const tx = db.transaction('profiles', 'readwrite');
	const now = Date.now();
	await Promise.all(
		[...profiles.entries()].map(([pubkey, profile]) =>
			tx.store.put({ pubkey, profile, cachedAt: now })
		)
	);
	await tx.done;
}

/**
 * Retrieve profiles for a list of pubkeys.
 * Returns a map of only the fresh, cached entries.
 * A value of null means the pubkey has no kind-0 event.
 * Keys not in the returned map need to be fetched from relays.
 */
export async function getProfiles(
	pubkeys: string[],
	ttl: number = TTL.profiles
): Promise<Map<string, NostrProfile | null>> {
	if (typeof window === 'undefined') return new Map();
	const db = await getDB();
	const result = new Map<string, NostrProfile | null>();

	await Promise.all(
		pubkeys.map(async (pk) => {
			const record = await db.get('profiles', pk);
			if (record && !isStale(record.cachedAt, ttl)) {
				result.set(pk, record.profile);
			}
		})
	);

	return result;
}

// ---------------------------------------------------------------------------
// Cache maintenance
// ---------------------------------------------------------------------------

/**
 * Purge all records older than their respective TTLs.
 * Safe to call periodically (e.g. on app mount).
 */
export async function pruneStaleCache(): Promise<void> {
	if (typeof window === 'undefined') return;
	const db = await getDB();
	const now = Date.now();

	// Prune events — use the longest TTL as a conservative cutoff;
	// individual TTLs are enforced at read time above.
	const eventTx = db.transaction('events', 'readwrite');
	let cursor = await eventTx.store.openCursor();
	while (cursor) {
		const { cachedAt, groupKey } = cursor.value;
		const ttl = groupKey.startsWith('followlist')
			? TTL.followList
			: TTL.articles; // articles / relaylist share 1h TTL
		if (now - cachedAt > ttl) await cursor.delete();
		cursor = await cursor.continue();
	}
	await eventTx.done;

	// Prune profiles
	const profileTx = db.transaction('profiles', 'readwrite');
	let pCursor = await profileTx.store.openCursor();
	while (pCursor) {
		if (now - pCursor.value.cachedAt > TTL.profiles) await pCursor.delete();
		pCursor = await pCursor.continue();
	}
	await profileTx.done;
}
