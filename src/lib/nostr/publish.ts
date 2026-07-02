import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { encodeNaddr } from '$lib/utils/nip19';

export type PublishResult = {
	success: boolean;
	event?: NostrEvent;
	naddr?: string;
	error?: string;
};

export async function publishArticle(opts: {
	title: string;
	content: string;
	summary?: string;
	image?: string;
	tags?: string[];
	identifier?: string;
	publishedAt?: number;
}): Promise<PublishResult> {
	const signer = get(auth);
	if (!signer) return { success: false, error: 'Not authenticated' };

	const identifier =
		opts.identifier ||
		opts.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') ||
		`post-${Date.now()}`;

	const tags: string[][] = [
		['d', identifier],
		['title', opts.title]
	];

	if (opts.summary) tags.push(['summary', opts.summary]);
	if (opts.image) tags.push(['image', opts.image]);
	if (opts.publishedAt) tags.push(['published_at', String(opts.publishedAt)]);
	for (const t of opts.tags || []) {
		tags.push(['t', t.toLowerCase()]);
	}

	const event: NostrEvent = {
		kind: 30023,
		created_at: Math.floor(Date.now() / 1000),
		tags,
		content: opts.content,
		pubkey: signer.pubkey
	} as NostrEvent;

	try {
		const signed = await signer.sign(event);

		const relayList = get(relays);
		const pool = new SimplePool();
		const promises = pool.publish(relayList, signed);
		await Promise.allSettled(promises);

		const naddr = encodeNaddr(signer.pubkey, identifier, relayList);

		return { success: true, event: signed, naddr };
	} catch (err) {
		return { success: false, error: String(err) };
	}
}
