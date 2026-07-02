/**
 * fetch.ts — Nostr relay fetching with IndexedDB cache-first strategy.
 *
 * Cache TTLs (defined in db.ts):
 *   Articles  (kind 30023) → 1 hour
 *   Follow list (kind 3)   → 30 minutes
 *   Relay list (kind 10002)→ 1 hour
 *
 * Pattern: check cache → if fresh, return immediately; else fetch relay,
 *           write to cache, return fresh data.
 */

import { SimplePool } from 'nostr-tools';
import type { NostrEvent, Filter } from 'nostr-tools';
import { getEvents, putEvents, getEvent, TTL } from '$lib/db';

let pool: SimplePool;

function getPool(): SimplePool {
	if (!pool) pool = new SimplePool();
	return pool;
}

// ---------------------------------------------------------------------------
// Articles (kind 30023)
// ---------------------------------------------------------------------------

export async function fetchArticles(
	relayUrls: string[],
	options?: { limit?: number; authors?: string[]; skipCache?: boolean }
): Promise<NostrEvent[]> {
	const { limit = 50, authors, skipCache = false } = options ?? {};
	if (authors && !authors.length) return [];
	const groupKey = authors ? `articles-authors-${[...authors].sort().join(',')}` : 'articles-all';

	if (!skipCache) {
		const cached = await getEvents(groupKey, TTL.articles);
		if (cached) {
			return cached.sort((a, b) => b.created_at - a.created_at).slice(0, limit);
		}
	}

	const filter: Filter = { kinds: [30023], ...(authors ? { authors } : {}), limit };
	const p = getPool();
	const events = await p.querySync(relayUrls, filter);
	const sorted = events.sort((a, b) => b.created_at - a.created_at);

	await putEvents(sorted, groupKey);

	return sorted;
}

/**
 * Fetch older articles (for "Load More" pagination).
 * Bypasses the cache — fetches directly from relays using `until` cursor.
 * Results are appended to the same cache group so subsequent page loads
 * don't need to re-fetch them.
 */
export async function fetchOlderArticles(
	relayUrls: string[],
	until: number,
	options?: { limit?: number; authors?: string[] }
): Promise<NostrEvent[]> {
	const { limit = 20, authors } = options ?? {};
	if (authors && !authors.length) return [];
	const groupKey = authors ? `articles-authors-${[...authors].sort().join(',')}` : 'articles-all';

	const filter: Filter = { kinds: [30023], ...(authors ? { authors } : {}), until, limit };
	const p = getPool();
	const events = await p.querySync(relayUrls, filter);
	const sorted = events.sort((a, b) => b.created_at - a.created_at);
	if (sorted.length > 0) await putEvents(sorted, groupKey);
	return sorted;
}

export async function fetchArticleByIdentifier(
	pubkey: string,
	identifier: string,
	relayUrls: string[]
): Promise<NostrEvent | null> {
	// Individual articles are stored under the authors group key when fetched
	// in bulk; for direct lookup we go to the relay (used infrequently).
	const filter: Filter = {
		kinds: [30023],
		authors: [pubkey],
		'#d': [identifier],
		limit: 1
	};

	const p = getPool();
	const events = await p.querySync(relayUrls, filter);
	const event = events[0] || null;

	// Cache the individual article if found
	if (event) await putEvents([event], `articles-author-${pubkey}`);

	return event;
}

// ---------------------------------------------------------------------------
// Follow list (kind 3)
// ---------------------------------------------------------------------------

/**
 * Fetch the follow list (kind 3) for a pubkey.
 * Returns the list of followed pubkeys.
 */
export async function fetchFollowList(
	pubkey: string,
	relayUrls: string[],
	skipCache = false
): Promise<string[]> {
	const groupKey = `followlist-${pubkey}`;

	// 1. Try cache
	if (!skipCache) {
		const cached = await getEvents(groupKey, TTL.followList);
		if (cached && cached.length > 0) {
			return cached[0].tags.filter(([t]) => t === 'p').map(([, pk]) => pk).filter(Boolean);
		}
	}

	// 2. Fetch from relay
	const filter: Filter = { kinds: [3], authors: [pubkey], limit: 1 };
	const p = getPool();
	const events = await p.querySync(relayUrls, filter);
	if (!events.length) return [];

	// 3. Persist to cache
	await putEvents([events[0]], groupKey);

	return events[0].tags.filter(([t]) => t === 'p').map(([, pk]) => pk).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Interaction scores (kinds 6, 7, 9735) — not cached (real-time data)
// ---------------------------------------------------------------------------

/**
 * Weights used for the Top Articles score.
 * kind 7  = reaction/like  → 1 pt
 * kind 6  = repost/boost   → 3 pts
 * kind 9735 = zap receipt  → 5 pts
 */
const WEIGHTS: Record<number, number> = { 7: 1, 6: 3, 9735: 5 };

/**
 * Given a list of articles, fetch their interaction events (reactions, reposts,
 * zaps) and return a Map<articleId, score>.
 *
 * Interaction counts are intentionally not cached — they are real-time signals
 * and should always reflect the latest relay state.
 */
export async function fetchInteractionScores(
	articles: NostrEvent[],
	relayUrls: string[]
): Promise<Map<string, number>> {
	if (!articles.length) return new Map();

	const ids = articles.map((a) => a.id);

	const filter: Filter = {
		kinds: [6, 7, 9735],
		'#e': ids,
		limit: 2000
	};

	const p = getPool();
	const interactions = await p.querySync(relayUrls, filter);

	const scores = new Map<string, number>(articles.map((a) => [a.id, 0]));

	for (const ev of interactions) {
		const eTags = ev.tags.filter(([t]) => t === 'e').map(([, id]) => id);
		const weight = WEIGHTS[ev.kind] ?? 1;
		for (const refId of eTags) {
			if (scores.has(refId)) {
				scores.set(refId, (scores.get(refId) ?? 0) + weight);
			}
		}
	}

	return scores;
}

// ---------------------------------------------------------------------------
// Relay list (kind 10002 / kind 3 fallback)
// ---------------------------------------------------------------------------

/**
 * Fetch the user's relay list.
 *
 * Priority:
 *  1. NIP-65 (kind 10002) — explicit read/write relay list
 *  2. Relay hints embedded in kind 3 (contact list) tags
 *
 * Returns deduplicated wss:// / ws:// URLs.
 */
export async function fetchRelayList(pubkey: string, bootstrapRelays: string[]): Promise<string[]> {
	const groupKey = `relaylist-${pubkey}`;
	const p = getPool();

	// 1. Try cache
	const cached = await getEvents(groupKey, TTL.relayList);
	if (cached && cached.length > 0) {
		return extractRelayUrlsFromEvents(cached, pubkey);
	}

	// 2. Try NIP-65 kind:10002
	const nip65Events = await p.querySync(bootstrapRelays, {
		kinds: [10002],
		authors: [pubkey],
		limit: 1
	});

	if (nip65Events.length > 0) {
		await putEvents(nip65Events, groupKey);
		const urls = nip65Events[0].tags
			.filter(([t]) => t === 'r')
			.map(([, url]) => url)
			.filter((url) => url && (url.startsWith('wss://') || url.startsWith('ws://')));
		if (urls.length > 0) return [...new Set(urls)];
	}

	// 3. Fallback: relay hints inside kind:3 contact list
	const kind3Events = await p.querySync(bootstrapRelays, {
		kinds: [3],
		authors: [pubkey],
		limit: 1
	});

	if (kind3Events.length > 0) {
		await putEvents(kind3Events, groupKey);
		try {
			const content = JSON.parse(kind3Events[0].content || '{}');
			const urls = Object.keys(content).filter(
				(url) => url.startsWith('wss://') || url.startsWith('ws://')
			);
			if (urls.length > 0) return [...new Set(urls)];
		} catch {
			// ignore JSON parse errors
		}
	}

	return [];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractRelayUrlsFromEvents(events: NostrEvent[], _pubkey: string): string[] {
	// NIP-65 style
	const fromNip65 = events
		.flatMap((ev) => ev.tags)
		.filter(([t]) => t === 'r')
		.map(([, url]) => url)
		.filter((url) => url && (url.startsWith('wss://') || url.startsWith('ws://')));

	if (fromNip65.length) return [...new Set(fromNip65)];

	// kind:3 content style
	for (const ev of events) {
		try {
			const content = JSON.parse(ev.content || '{}');
			const urls = Object.keys(content).filter(
				(url) => url.startsWith('wss://') || url.startsWith('ws://')
			);
			if (urls.length) return [...new Set(urls)];
		} catch {
			// ignore
		}
	}

	return [];
}
