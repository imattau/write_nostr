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

function loadDrafts(): Draft[] {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
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
				const idx = d.findIndex((x) => x.id === draft.id);
				const next = idx >= 0 ? [...d] : [draft, ...d];
				if (idx >= 0) next[idx] = draft;
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
