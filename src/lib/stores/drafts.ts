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

const STORAGE_KEY = 'write_drafts';

function normalizeDraft(raw: Partial<Draft> & { id?: unknown }): Draft | null {
	if (!raw || typeof raw !== 'object') return null;

	const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : generateId();
	const title = typeof raw.title === 'string' ? raw.title : '';
	const content = typeof raw.content === 'string' ? raw.content : '';
	const summary = typeof raw.summary === 'string' ? raw.summary : '';
	const image = typeof raw.image === 'string' ? raw.image : '';
	const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [];
	const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now();
	const publishedAt = typeof raw.publishedAt === 'number' && Number.isFinite(raw.publishedAt) ? raw.publishedAt : undefined;

	return {
		id,
		title,
		content,
		summary,
		tags,
		image,
		updatedAt,
		publishedAt
	};
}

function loadDrafts(): Draft[] {
	try {
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown;
		if (!Array.isArray(stored)) return [];
		return stored.map((draft) => normalizeDraft(draft as Partial<Draft>)).filter((draft): draft is Draft => draft !== null);
	} catch {
		return [];
	}
}

function saveDrafts(drafts: Draft[]) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

function createDraftsStore() {
	const { subscribe, set, update } = writable<Draft[]>(loadDrafts());

	return {
		subscribe,
		save(draft: Draft) {
			update((d) => {
				const nextDraft = normalizeDraft(draft);
				if (!nextDraft) return d;

				const idx = d.findIndex((x) => x.id === nextDraft.id);
				const next = idx >= 0 ? [...d] : [nextDraft, ...d];
				if (idx >= 0) next[idx] = nextDraft;
				saveDrafts(next);
				return next;
			});
		},
		remove(id: string) {
			update((d) => {
				const next = d.filter((x) => x.id !== id);
				saveDrafts(next);
				return next;
			});
		},
		getById(id: string): Draft | undefined {
			return get({ subscribe }).find((d) => d.id === id);
		}
	};
}

export const drafts = createDraftsStore();

export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
