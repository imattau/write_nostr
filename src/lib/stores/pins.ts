import { writable, derived, get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { loadList, saveList, type ListEntry } from '$lib/nostr/lists';

const PINS_KIND = 10001;
const pinListEntries = writable<ListEntry[]>([]);

export const pinEntries = derived(pinListEntries, ($e) => $e);
export const pinnedCoordinates = derived(
	pinListEntries,
	($entries) => new Set($entries.map((e) => e.tag[1]))
);

export async function loadPins(): Promise<void> {
	const signer = get(auth);
	if (!signer) return;
	const entries = await loadList(signer, get(relays), { kind: PINS_KIND });
	pinListEntries.set(entries);
}

export async function addPin(coordinate: string, opts: { private?: boolean } = {}): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');
	const isPrivate = opts.private ?? false;
	pinListEntries.update((entries) => {
		if (entries.some((e) => e.tag[1] === coordinate)) return entries;
		return [...entries, { tag: ['a', coordinate], private: isPrivate }];
	});
	await saveList(signer, get(relays), { kind: PINS_KIND }, get(pinListEntries));
}

export async function removePin(coordinate: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');
	pinListEntries.update((entries) => entries.filter((e) => e.tag[1] !== coordinate));
	await saveList(signer, get(relays), { kind: PINS_KIND }, get(pinListEntries));
}

export async function setPinEntryPrivacy(coordinate: string, isPrivate: boolean): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');
	pinListEntries.update((entries) =>
		entries.map((e) => (e.tag[1] === coordinate ? { ...e, private: isPrivate } : e))
	);
	await saveList(signer, get(relays), { kind: PINS_KIND }, get(pinListEntries));
}
