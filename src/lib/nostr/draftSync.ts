import { SimplePool, verifyEvent } from 'nostr-tools';
import type { NostrEvent, VerifiedEvent } from 'nostr-tools';
import { get, writable } from 'svelte/store';
import { auth, type Signer } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import {
	activateDraftAccount,
	applyRemoteDraft,
	applyRemoteDraftDeletion,
	drafts,
	getActiveDraftAccount,
	getDraftTombstones,
	normalizeDraft,
	setDraftMutationListener,
	type Draft,
	type DraftSyncValue
} from '$lib/stores/drafts';

const KIND = 30078;
const DRAFT_PREFIX = 'write-nostr:encrypted-draft:';
const DIRTY_PREFIX = 'write_draft_sync_dirty_';
const CACHE_PREFIX = 'write_draft_sync_events_';
const INITIALIZED_PREFIX = 'write_draft_sync_initialized_';
const CHUNK_SIZE = 8000;
const MAX_CHUNKS = 500;

export type DraftSyncStatus = {
	state: 'idle' | 'syncing' | 'synced' | 'unavailable' | 'error';
	message: string;
	pubkey: string | null;
};

type DraftHead = {
	version: 1;
	id: string;
	revision: string;
	totalChunks: number;
	updatedAt: number;
	deleted: boolean;
};

type DraftChunk = { version: 1; id: string; revision: string; index: number; text: string };
type DraftRecord = { id: string; head: NostrEvent; value: DraftSyncValue; error?: string };

export const draftSyncStatus = writable<DraftSyncStatus>({ state: 'idle', message: '', pubkey: null });

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<void>>();

function dirtyKey(pubkey: string) { return `${DIRTY_PREFIX}${pubkey}`; }
function cacheKey(pubkey: string) { return `${CACHE_PREFIX}${pubkey}`; }
function initializedKey(pubkey: string) { return `${INITIALIZED_PREFIX}${pubkey}`; }
function encodeId(id: string) { return encodeURIComponent(id); }
function headTag(id: string) { return `${DRAFT_PREFIX}${encodeId(id)}:head`; }
function idFromHeadTag(value: string): string | null {
	if (!value.startsWith(DRAFT_PREFIX) || !value.endsWith(':head')) return null;
	try { return decodeURIComponent(value.slice(DRAFT_PREFIX.length, -':head'.length)); }
	catch { return null; }
}

function readDirty(pubkey: string): Record<string, number> {
	try {
		const value = JSON.parse(localStorage.getItem(dirtyKey(pubkey)) || '{}');
		return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	} catch { return {}; }
}

function writeDirty(pubkey: string, value: Record<string, number>): void {
	if (Object.keys(value).length) localStorage.setItem(dirtyKey(pubkey), JSON.stringify(value));
	else localStorage.removeItem(dirtyKey(pubkey));
}

function readEventCache(pubkey: string): Map<string, NostrEvent> {
	try {
		const parsed = JSON.parse(localStorage.getItem(cacheKey(pubkey)) || '{}') as Record<string, NostrEvent>;
		const cache = new Map<string, NostrEvent>();
		for (const [tag, event] of Object.entries(parsed)) {
			if (event?.pubkey === pubkey && event.kind === KIND && verifyEvent(event) && event.tags.some(([key, value]) => key === 'd' && value === tag)) cache.set(tag, event);
		}
		return cache;
	} catch { return new Map(); }
}

function writeEventCache(pubkey: string, cache: Map<string, NostrEvent>): void {
	try { localStorage.setItem(cacheKey(pubkey), JSON.stringify(Object.fromEntries(cache))); }
	catch { /* The relays remain the durable copy if local cache storage is full. */ }
}

function mergeEvent(cache: Map<string, NostrEvent>, event: NostrEvent): void {
	const tag = event.tags.find(([key]) => key === 'd')?.[1];
	if (!tag || event.kind !== KIND || !verifyEvent(event)) return;
	const prior = cache.get(tag);
	if (!prior || event.created_at > prior.created_at || (event.created_at === prior.created_at && event.id > prior.id)) cache.set(tag, event);
}

function compareEvents(a: NostrEvent, b: NostrEvent): number {
	return a.created_at - b.created_at || a.id.localeCompare(b.id);
}

function createPool(signer: Signer): SimplePool {
	const pool = new SimplePool();
	pool.automaticallyAuth = () => async (template) => await signer.sign({ ...template, pubkey: signer.pubkey } as NostrEvent) as VerifiedEvent;
	return pool;
}

function splitText(text: string): string[] {
	const chunks: string[] = [];
	let chunk = '';
	for (const character of text) {
		if (chunk.length + character.length > CHUNK_SIZE) {
			chunks.push(chunk);
			chunk = '';
		}
		chunk += character;
	}
	if (chunk || chunks.length === 0) chunks.push(chunk);
	if (chunks.length > MAX_CHUNKS) throw new Error('This draft is too large to sync. It remains saved on this device.');
	return chunks;
}

async function signEncryptedEvent(signer: Signer, dTag: string, value: unknown, createdAt: number): Promise<NostrEvent> {
	if (!signer.nip44) throw new Error('Your signer does not support NIP-44 encrypted draft sync.');
	const content = await signer.nip44.encrypt(signer.pubkey, JSON.stringify(value));
	const event = await signer.sign({ kind: KIND, created_at: createdAt, tags: [['d', dTag]], content, pubkey: signer.pubkey } as NostrEvent);
	if (event.pubkey !== signer.pubkey || event.kind !== KIND || !verifyEvent(event)) throw new Error('The signer returned an invalid encrypted draft event.');
	return event;
}

async function acceptedBy(pool: SimplePool, urls: string[], event: NostrEvent): Promise<string[]> {
	const results = await Promise.allSettled(pool.publish(urls, event));
	return urls.filter((_, index) => results[index]?.status === 'fulfilled');
}

function intersection(left: string[], right: string[]): string[] {
	const allowed = new Set(right);
	return left.filter((url) => allowed.has(url));
}

async function publishState(signer: Signer, pool: SimplePool, id: string, value: DraftSyncValue, cache: Map<string, NostrEvent>): Promise<void> {
	const previousHead = cache.get(headTag(id));
	const createdAt = Math.max(Math.floor(Date.now() / 1000), (previousHead?.created_at ?? 0) + 1);
	const revision = `${createdAt.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	const draft = 'draft' in value ? value.draft : null;
	const serialized = draft ? JSON.stringify(draft) : '';
	const chunks = draft ? splitText(serialized) : [];
	let acceptedRelays = get(relays);
	const newChunkEvents: NostrEvent[] = [];
	for (let index = 0; index < chunks.length; index++) {
		const dTag = `${DRAFT_PREFIX}${encodeId(id)}:${revision}:${index}`;
		const event = await signEncryptedEvent(signer, dTag, { version: 1, id, revision, index, text: chunks[index] } satisfies DraftChunk, createdAt);
		newChunkEvents.push(event);
		acceptedRelays = intersection(acceptedRelays, await acceptedBy(pool, acceptedRelays, event));
		if (!acceptedRelays.length) throw new Error('Could not save all encrypted draft parts to a common relay. Your local draft is safe; sync will retry on your next change or login.');
	}
	const head: DraftHead = {
		version: 1,
		id,
		revision,
		totalChunks: chunks.length,
		updatedAt: draft?.updatedAt ?? ('deleted' in value ? value.deleted.updatedAt : Date.now()),
		deleted: !draft
	};
	const headEvent = await signEncryptedEvent(signer, headTag(id), head, createdAt);
	acceptedRelays = intersection(acceptedRelays, await acceptedBy(pool, acceptedRelays, headEvent));
	if (!acceptedRelays.length) throw new Error('Could not commit the encrypted draft to a relay. Your local draft is safe; sync will retry on your next change or login.');
	for (const event of newChunkEvents) mergeEvent(cache, event);
	mergeEvent(cache, headEvent);
	writeEventCache(signer.pubkey, cache);

	// Remove obsolete encrypted chunks only from relays that accepted the complete new revision.
	if (previousHead) {
		const previousRevision = await decryptHead(signer, previousHead, id).catch(() => null);
		if (previousRevision && previousRevision.revision !== revision && previousRevision.totalChunks > 0) {
			const oldParts = [...cache.values()].filter((event) => {
				const tag = event.tags.find(([key]) => key === 'd')?.[1] || '';
				return tag.startsWith(`${DRAFT_PREFIX}${encodeId(id)}:${previousRevision.revision}:`);
			});
			if (oldParts.length) {
				const deletion = await signer.sign({
					kind: 5,
					created_at: createdAt + 1,
					tags: oldParts.map((event) => ['e', event.id]),
					content: 'Replaced by a newer encrypted draft version.',
					pubkey: signer.pubkey
				} as NostrEvent);
				if (verifyEvent(deletion)) await acceptedBy(pool, acceptedRelays, deletion);
				for (const event of oldParts) {
					const tag = event.tags.find(([key]) => key === 'd')?.[1];
					if (tag) cache.delete(tag);
				}
				writeEventCache(signer.pubkey, cache);
			}
		}
	}
}

async function decryptHead(signer: Signer, event: NostrEvent, id: string): Promise<DraftHead | null> {
	if (!signer.nip44) return null;
	try {
		const parsed = JSON.parse(await signer.nip44.decrypt(signer.pubkey, event.content)) as Partial<DraftHead>;
		if (parsed.version !== 1 || parsed.id !== id || typeof parsed.revision !== 'string' || !Number.isInteger(parsed.totalChunks) || parsed.totalChunks! < 0 || parsed.totalChunks! > MAX_CHUNKS || typeof parsed.updatedAt !== 'number' || typeof parsed.deleted !== 'boolean') return null;
		if (parsed.deleted ? parsed.totalChunks !== 0 : parsed.totalChunks! < 1) return null;
		return parsed as DraftHead;
	} catch { return null; }
}

async function decryptRemoteRecord(signer: Signer, headEvent: NostrEvent, head: DraftHead, cache: Map<string, NostrEvent>): Promise<DraftRecord> {
	if (head.deleted) return { id: head.id, head: headEvent, value: { deleted: { id: head.id, updatedAt: head.updatedAt } } };
	const parts: string[] = [];
	for (let index = 0; index < head.totalChunks; index++) {
		const tag = `${DRAFT_PREFIX}${encodeId(head.id)}:${head.revision}:${index}`;
		const event = cache.get(tag);
		if (!event || !signer.nip44) return { id: head.id, head: headEvent, value: { deleted: { id: head.id, updatedAt: head.updatedAt } }, error: 'Encrypted draft parts are incomplete; kept the local copy.' };
		try {
			const chunk = JSON.parse(await signer.nip44.decrypt(signer.pubkey, event.content)) as Partial<DraftChunk>;
			if (chunk.version !== 1 || chunk.id !== head.id || chunk.revision !== head.revision || chunk.index !== index || typeof chunk.text !== 'string') throw new Error();
			parts.push(chunk.text);
		} catch {
			return { id: head.id, head: headEvent, value: { deleted: { id: head.id, updatedAt: head.updatedAt } }, error: 'Could not decrypt a draft part; kept the local copy.' };
		}
	}
	try {
		const draft = normalizeDraft(JSON.parse(parts.join('')) as Draft);
		if (!draft || draft.id !== head.id) throw new Error();
		return { id: head.id, head: headEvent, value: { draft } };
	} catch {
		return { id: head.id, head: headEvent, value: { deleted: { id: head.id, updatedAt: head.updatedAt } }, error: 'The encrypted draft has invalid data; kept the local copy.' };
	}
}

async function fetchRemoteRecords(signer: Signer, pool: SimplePool, cache: Map<string, NostrEvent>): Promise<Map<string, DraftRecord>> {
	const events = await pool.querySync(get(relays), { kinds: [KIND], authors: [signer.pubkey], limit: 5000 });
	for (const event of events) {
		const dTag = event.tags.find(([key]) => key === 'd')?.[1] || '';
		if (dTag.startsWith(DRAFT_PREFIX) && event.pubkey === signer.pubkey && verifyEvent(event)) mergeEvent(cache, event);
	}
	const heads = [...cache.entries()]
		.filter(([tag]) => idFromHeadTag(tag) !== null)
		.map(([, event]) => event)
		.sort(compareEvents);
	const latestHeads = new Map<string, NostrEvent>();
	for (const event of heads) {
		const tag = event.tags.find(([key]) => key === 'd')?.[1] || '';
		const id = idFromHeadTag(tag);
		if (id) latestHeads.set(id, event);
	}
	const decodedHeads = new Map<string, DraftHead>();
	const wantedParts: string[] = [];
	for (const [id, event] of latestHeads) {
		const head = await decryptHead(signer, event, id);
		if (!head) continue;
		decodedHeads.set(id, head);
		for (let index = 0; index < head.totalChunks; index++) wantedParts.push(`${DRAFT_PREFIX}${encodeId(id)}:${head.revision}:${index}`);
	}
	for (let offset = 0; offset < wantedParts.length; offset += 200) {
		const batch = wantedParts.slice(offset, offset + 200);
		const partEvents = await pool.querySync(get(relays), { kinds: [KIND], authors: [signer.pubkey], '#d': batch, limit: batch.length });
		for (const event of partEvents) {
			const tag = event.tags.find(([key]) => key === 'd')?.[1] || '';
			if (batch.includes(tag) && event.pubkey === signer.pubkey && verifyEvent(event)) mergeEvent(cache, event);
		}
	}
	const result = new Map<string, DraftRecord>();
	for (const [id, head] of decodedHeads) {
		const event = latestHeads.get(id)!;
		result.set(id, await decryptRemoteRecord(signer, event, head, cache));
	}
	writeEventCache(signer.pubkey, cache);
	return result;
}

function localValue(id: string): DraftSyncValue | null {
	const draft = drafts.getById(id);
	if (draft) return { draft };
	const tombstone = getDraftTombstones().find((item) => item.id === id);
	return tombstone ? { deleted: tombstone } : null;
}

async function synchronize(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer || signer.pubkey !== pubkey || getActiveDraftAccount() !== pubkey) return;
	if (!signer.nip44) {
		draftSyncStatus.set({ state: 'unavailable', pubkey, message: 'Your signer does not support NIP-44 encrypted draft sync. Drafts are saved on this device.' });
		return;
	}
	draftSyncStatus.set({ state: 'syncing', pubkey, message: 'Syncing encrypted drafts…' });
	const firstSync = localStorage.getItem(initializedKey(pubkey)) !== '1';
	const cache = readEventCache(pubkey);
	const previousHeads = new Map([...cache].filter(([tag]) => idFromHeadTag(tag) !== null));
	const pool = createPool(signer);
	let message = 'Encrypted drafts synced.';
	try {
		const remoteRecords = await fetchRemoteRecords(signer, pool, cache);
		const publishLocal = async (id: string, value: DraftSyncValue) => {
			const dirtyBefore = readDirty(pubkey)[id];
			await publishState(signer, pool, id, value, cache);
			if (dirtyBefore !== undefined) {
				const latest = readDirty(pubkey);
				if (latest[id] === dirtyBefore) {
					delete latest[id];
					writeDirty(pubkey, latest);
				}
			}
		};
		const ids = new Set<string>([
			...get(drafts).map((draft) => draft.id),
			...getDraftTombstones().map((item) => item.id),
			...remoteRecords.keys()
		]);
		for (const id of ids) {
			if (get(auth)?.pubkey !== pubkey || getActiveDraftAccount() !== pubkey) return;
			const remote = remoteRecords.get(id);
			const current = localValue(id);
			const isDirty = Object.hasOwn(readDirty(pubkey), id);
			if (remote?.error) {
				message = remote.error;
				continue;
			}
			if (!remote) {
				if (current && (isDirty || firstSync || !previousHeads.has(headTag(id)))) await publishLocal(id, current);
				continue;
			}
			const cachedHead = previousHeads.get(headTag(id));
			const remoteIsNewer = !cachedHead || compareEvents(remote.head, cachedHead) > 0;
			if (isDirty || (current && firstSync)) {
				if (current) await publishLocal(id, current);
				continue;
			}
			if (current && !cachedHead) {
				const localUpdatedAt = 'draft' in current ? current.draft.updatedAt : current.deleted.updatedAt;
				// With no local event cache, use the encrypted record timestamp to avoid
				// replacing a locally newer draft after a cache clear/reinstall.
				const remoteUpdatedAt = 'draft' in remote.value ? remote.value.draft.updatedAt : remote.value.deleted.updatedAt;
				if (remoteUpdatedAt <= localUpdatedAt) {
					await publishLocal(id, current);
					continue;
				}
			}
			if (remoteIsNewer || !current) {
				if ('draft' in remote.value) applyRemoteDraft(remote.value.draft);
				else applyRemoteDraftDeletion(remote.value.deleted);
			}
		}
		localStorage.setItem(initializedKey(pubkey), '1');
		draftSyncStatus.set({ state: message === 'Encrypted drafts synced.' ? 'synced' : 'error', pubkey, message });
	} catch (error) {
		draftSyncStatus.set({ state: 'error', pubkey, message: error instanceof Error ? error.message : 'Could not sync encrypted drafts. Local drafts remain saved.' });
	} finally {
		pool.destroy();
		if (Object.keys(readDirty(pubkey)).length && get(auth)?.pubkey === pubkey && getActiveDraftAccount() === pubkey) scheduleEncryptedDraftSync(pubkey);
	}
}

export function initializeEncryptedDraftSync(pubkey: string): Promise<void> {
	if (get(auth)?.pubkey !== pubkey) return Promise.resolve();
	activateDraftAccount(pubkey);
	const existing = inFlight.get(pubkey);
	if (existing) return existing;
	const task = synchronize(pubkey).finally(() => inFlight.delete(pubkey));
	inFlight.set(pubkey, task);
	return task;
}

function scheduleEncryptedDraftSync(pubkey: string): void {
	if (typeof localStorage === 'undefined' || getActiveDraftAccount() !== pubkey) return;
	const timer = pendingTimers.get(pubkey);
	if (timer) clearTimeout(timer);
	draftSyncStatus.set({ state: 'syncing', pubkey, message: 'Encrypted drafts will sync shortly…' });
	pendingTimers.set(pubkey, setTimeout(() => {
		pendingTimers.delete(pubkey);
		const current = inFlight.get(pubkey);
		if (current) {
			current.then(() => void initializeEncryptedDraftSync(pubkey));
			return;
		}
		void initializeEncryptedDraftSync(pubkey);
	}, 1000));
}

setDraftMutationListener((pubkey, value: DraftSyncValue) => {
	if (typeof localStorage === 'undefined') return;
	const id = 'draft' in value ? value.draft.id : value.deleted.id;
	const dirty = readDirty(pubkey);
	dirty[id] = Math.max(Date.now(), (dirty[id] || 0) + 1);
	writeDirty(pubkey, dirty);
	scheduleEncryptedDraftSync(pubkey);
});

export function retryEncryptedDraftSync(pubkey: string): void {
	if (getActiveDraftAccount() !== pubkey) return;
	const dirty = readDirty(pubkey);
	for (const draft of get(drafts)) dirty[draft.id] = Date.now();
	for (const tombstone of getDraftTombstones()) dirty[tombstone.id] = Date.now();
	writeDirty(pubkey, dirty);
	scheduleEncryptedDraftSync(pubkey);
}
