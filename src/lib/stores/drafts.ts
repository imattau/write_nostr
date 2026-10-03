import { writable, get } from 'svelte/store';

export type Draft = {
	id: string;
	title: string;
	content: string;
	summary: string;
	tags: string[];
	image: string;
	updatedAt: number;
	publishedAt?: number;
};

export type DraftTombstone = { id: string; updatedAt: number };
export type DraftSyncValue = { draft: Draft } | { deleted: DraftTombstone };
type DraftMutationListener = (pubkey: string, value: DraftSyncValue) => void;

const LEGACY_STORAGE_KEY = 'write_drafts';
let activePubkey: string | null = null;
let mutationListener: DraftMutationListener | null = null;

function storageKey(pubkey: string) { return `write_drafts_${pubkey}`; }
function tombstoneKey(pubkey: string) { return `write_draft_tombstones_${pubkey}`; }

export function normalizeDraft(raw: Partial<Draft> & { id?: unknown }): Draft | null {
	if (!raw || typeof raw !== 'object') return null;
	const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : generateId();
	const title = typeof raw.title === 'string' ? raw.title : '';
	const content = typeof raw.content === 'string' ? raw.content : '';
	const summary = typeof raw.summary === 'string' ? raw.summary : '';
	const image = typeof raw.image === 'string' ? raw.image : '';
	const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [];
	const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now();
	const publishedAt = typeof raw.publishedAt === 'number' && Number.isFinite(raw.publishedAt) ? raw.publishedAt : undefined;
	return { id, title, content, summary, tags, image, updatedAt, publishedAt };
}

function loadDraftList(key: string): Draft[] {
	try {
		const stored = JSON.parse(localStorage.getItem(key) || '[]') as unknown;
		if (!Array.isArray(stored)) return [];
		return stored.map((draft) => normalizeDraft(draft as Partial<Draft>)).filter((draft): draft is Draft => draft !== null);
	} catch {
		return [];
	}
}

function loadTombstones(pubkey: string): DraftTombstone[] {
	try {
		const stored = JSON.parse(localStorage.getItem(tombstoneKey(pubkey)) || '[]') as unknown;
		if (!Array.isArray(stored)) return [];
		return stored.filter((item): item is DraftTombstone => Boolean(item && typeof item.id === 'string' && typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)));
	} catch {
		return [];
	}
}

function writeDraftList(pubkey: string, value: Draft[]) {
	localStorage.setItem(storageKey(pubkey), JSON.stringify(value));
}

function writeTombstones(pubkey: string, value: DraftTombstone[]) {
	localStorage.setItem(tombstoneKey(pubkey), JSON.stringify(value));
}

const { subscribe, set, update } = writable<Draft[]>([]);

export function activateDraftAccount(pubkey: string | null): void {
	if (activePubkey === pubkey) return;
	activePubkey = pubkey;
	if (!pubkey || typeof localStorage === 'undefined') {
		set([]);
		return;
	}

	// Migrate pre-account drafts once, assigning them to the first account that logs in.
	if (localStorage.getItem('write_drafts_account_migrated') !== '1') {
		const scoped = localStorage.getItem(storageKey(pubkey));
		if (!scoped) {
			const legacy = loadDraftList(LEGACY_STORAGE_KEY);
			if (legacy.length) localStorage.setItem(storageKey(pubkey), JSON.stringify(legacy));
		}
		localStorage.removeItem(LEGACY_STORAGE_KEY);
		localStorage.setItem('write_drafts_account_migrated', '1');
	}
	set(loadDraftList(storageKey(pubkey)));
}

export function setDraftMutationListener(listener: DraftMutationListener | null): void {
	mutationListener = listener;
}

export function getDraftTombstones(): DraftTombstone[] {
	if (!activePubkey || typeof localStorage === 'undefined') return [];
	return loadTombstones(activePubkey);
}

export function getActiveDraftAccount(): string | null { return activePubkey; }

export function applyRemoteDraft(draft: Draft): void {
	const pubkey = activePubkey;
	if (!pubkey || typeof localStorage === 'undefined') return;
	const value = normalizeDraft(draft);
	if (!value) return;
	update((current) => {
		const index = current.findIndex((item) => item.id === value.id);
		const next = index < 0 ? [value, ...current] : current.map((item, i) => i === index ? value : item);
		writeDraftList(pubkey, next);
		return next;
	});
	writeTombstones(pubkey, loadTombstones(pubkey).filter((item) => item.id !== value.id));
}

export function applyRemoteDraftDeletion(tombstone: DraftTombstone): void {
	const pubkey = activePubkey;
	if (!pubkey || typeof localStorage === 'undefined') return;
	update((current) => {
		const next = current.filter((item) => item.id !== tombstone.id);
		writeDraftList(pubkey, next);
		return next;
	});
	const tombstones = loadTombstones(pubkey).filter((item) => item.id !== tombstone.id);
	tombstones.push(tombstone);
	writeTombstones(pubkey, tombstones);
}

export const drafts = {
	subscribe,
	save(draft: Draft) {
		const pubkey = activePubkey;
		if (!pubkey || typeof localStorage === 'undefined') return;
		const nextDraft = normalizeDraft(draft);
		if (!nextDraft) return;
		update((current) => {
			const index = current.findIndex((item) => item.id === nextDraft.id);
			const next = index < 0 ? [nextDraft, ...current] : current.map((item, i) => i === index ? nextDraft : item);
			writeDraftList(pubkey, next);
			return next;
		});
		writeTombstones(pubkey, loadTombstones(pubkey).filter((item) => item.id !== nextDraft.id));
		mutationListener?.(pubkey, { draft: nextDraft });
	},
	remove(id: string) {
		const pubkey = activePubkey;
		if (!pubkey || typeof localStorage === 'undefined') return;
		const tombstone = { id, updatedAt: Date.now() };
		update((current) => {
			const next = current.filter((item) => item.id !== id);
			writeDraftList(pubkey, next);
			return next;
		});
		const tombstones = loadTombstones(pubkey).filter((item) => item.id !== id);
		tombstones.push(tombstone);
		writeTombstones(pubkey, tombstones);
		mutationListener?.(pubkey, { deleted: tombstone });
	},
	getById(id: string): Draft | undefined {
		return get({ subscribe }).find((draft) => draft.id === id);
	}
};

export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
