import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import type { Signer } from '$lib/stores/auth';
import { encryptPrivateTags, decryptPrivateTags } from './listCrypto';

export type ListEntry = { tag: string[]; private: boolean };

export type ListSpec = {
	kind: number;
	/** Required for parameterized-replaceable lists (e.g. kind 30000). */
	dTag?: string;
};

/** Pure: merges decrypted public/private tag arrays into one ordered ListEntry[] (public first). */
export function tagsToEntries(publicTags: string[][], privateTags: string[][]): ListEntry[] {
	return [
		...publicTags.map((tag) => ({ tag, private: false as const })),
		...privateTags.map((tag) => ({ tag, private: true as const }))
	];
}

/** Pure: splits entries into public/private tag arrays, prepending a d tag to public tags if given. */
export function entriesToTags(
	entries: ListEntry[],
	dTag?: string
): { publicTags: string[][]; privateTags: string[][] } {
	const publicTags = entries.filter((e) => !e.private).map((e) => e.tag);
	const privateTags = entries.filter((e) => e.private).map((e) => e.tag);
	return {
		publicTags: dTag !== undefined ? [['d', dTag], ...publicTags] : publicTags,
		privateTags
	};
}

/** Fetches a NIP-51 list event for the signer's own pubkey and merges its public+private tags. */
export async function loadList(
	signer: Signer,
	relayList: string[],
	spec: ListSpec
): Promise<ListEntry[]> {
	const pool = new SimplePool();
	try {
		const filter: Record<string, unknown> = {
			kinds: [spec.kind],
			authors: [signer.pubkey],
			limit: 1
		};
		if (spec.dTag !== undefined) filter['#d'] = [spec.dTag];

		const events = await pool.querySync(relayList, filter as Parameters<typeof pool.querySync>[1]);
		const event = events.sort((a, b) => b.created_at - a.created_at)[0];
		if (!event) return [];

		const publicTags = event.tags.filter(([key]) => key !== 'd');
		const privateTags = await decryptPrivateTags(signer, event.content);
		return tagsToEntries(publicTags, privateTags);
	} finally {
		pool.destroy();
	}
}

/** Builds, signs, and publishes a NIP-51 list event from a full entry set (replaces the whole list). */
export async function saveList(
	signer: Signer,
	relayList: string[],
	spec: ListSpec,
	entries: ListEntry[]
): Promise<void> {
	const { publicTags, privateTags } = entriesToTags(entries, spec.dTag);
	const content = await encryptPrivateTags(signer, privateTags);

	const event: NostrEvent = {
		kind: spec.kind,
		created_at: Math.floor(Date.now() / 1000),
		tags: publicTags,
		content,
		pubkey: signer.pubkey
	} as NostrEvent;

	const signed = await signer.sign(event);
	const pool = new SimplePool();
	try {
		await Promise.allSettled(pool.publish(relayList, signed));
	} finally {
		pool.destroy();
	}
}
