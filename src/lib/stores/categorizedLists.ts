import { writable, derived, get } from 'svelte/store';
import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { saveList, tagsToEntries, type ListEntry } from '$lib/nostr/lists';
import { decryptPrivateTags } from '$lib/nostr/listCrypto';

const CATEGORIZED_KIND = 30000;

export type CategorizedList = { name: string; entries: ListEntry[] };

const listsStore = writable<CategorizedList[]>([]);

export const categorizedLists = derived(listsStore, ($l) => $l);

export async function loadCategorizedLists(): Promise<void> {
	const signer = get(auth);
	if (!signer) return;

	const pool = new SimplePool();
	let events: NostrEvent[];
	try {
		events = await pool.querySync(get(relays), {
			kinds: [CATEGORIZED_KIND],
			authors: [signer.pubkey]
		});
	} finally {
		pool.destroy();
	}

	const latestByName = new Map<string, NostrEvent>();
	for (const event of events) {
		const name = event.tags.find(([k]) => k === 'd')?.[1];
		if (!name) continue;
		const existing = latestByName.get(name);
		if (!existing || event.created_at > existing.created_at) latestByName.set(name, event);
	}

	const result: CategorizedList[] = [];
	for (const [name, event] of latestByName) {
		const publicTags = event.tags.filter(([k]) => k !== 'd');
		const privateTags = await decryptPrivateTags(signer, event.content);
		result.push({ name, entries: tagsToEntries(publicTags, privateTags) });
	}
	listsStore.set(result);
}

export async function createCategorizedList(name: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');
	if (get(listsStore).some((l) => l.name === name)) throw new Error('A list with that name already exists');

	listsStore.update((lists) => [...lists, { name, entries: [] }]);
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, []);
}

export async function renameCategorizedList(oldName: string, newName: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const list = get(listsStore).find((l) => l.name === oldName);
	if (!list) throw new Error(`List "${oldName}" not found`);

	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: newName }, list.entries);
	await deleteCategorizedList(oldName);

	listsStore.update((lists) => lists.map((l) => (l.name === oldName ? { ...l, name: newName } : l)));
}

export async function deleteCategorizedList(name: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, []);

	const coordinate = `${CATEGORIZED_KIND}:${signer.pubkey}:${name}`;
	const deletionEvent: NostrEvent = {
		kind: 5,
		created_at: Math.floor(Date.now() / 1000),
		tags: [['a', coordinate]],
		content: 'list deleted',
		pubkey: signer.pubkey
	} as NostrEvent;
	const signed = await signer.sign(deletionEvent);
	const pool = new SimplePool();
	try {
		await Promise.allSettled(pool.publish(get(relays), signed));
	} finally {
		pool.destroy();
	}

	listsStore.update((lists) => lists.filter((l) => l.name !== name));
}

export async function addPersonToList(
	name: string,
	pubkey: string,
	opts: { private?: boolean } = {}
): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const isPrivate = opts.private ?? false;
	listsStore.update((lists) =>
		lists.map((l) => {
			if (l.name !== name) return l;
			if (l.entries.some((e) => e.tag[1] === pubkey)) return l;
			return { ...l, entries: [...l.entries, { tag: ['p', pubkey], private: isPrivate }] };
		})
	);

	const list = get(listsStore).find((l) => l.name === name);
	if (!list) throw new Error(`List "${name}" not found`);
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, list.entries);
}

export async function removePersonFromList(name: string, pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	listsStore.update((lists) =>
		lists.map((l) => (l.name === name ? { ...l, entries: l.entries.filter((e) => e.tag[1] !== pubkey) } : l))
	);

	const list = get(listsStore).find((l) => l.name === name);
	if (!list) throw new Error(`List "${name}" not found`);
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, list.entries);
}

export async function setListEntryPrivacy(name: string, pubkey: string, isPrivate: boolean): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	listsStore.update((lists) =>
		lists.map((l) =>
			l.name === name
				? { ...l, entries: l.entries.map((e) => (e.tag[1] === pubkey ? { ...e, private: isPrivate } : e)) }
				: l
		)
	);

	const list = get(listsStore).find((l) => l.name === name);
	if (!list) throw new Error(`List "${name}" not found`);
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, list.entries);
}
