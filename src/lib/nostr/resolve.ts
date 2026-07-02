import type { NostrEvent } from 'nostr-tools';
import { decodeNaddr, type NaddrParts } from '$lib/utils/nip19';
import { fetchArticleByIdentifier } from './fetch';

export async function resolveNaddr(naddr: string): Promise<{
	event: NostrEvent | null;
	meta: NaddrParts | null;
}> {
	const meta = decodeNaddr(naddr);
	if (!meta) return { event: null, meta: null };

	const relays = meta.relays?.length ? meta.relays : ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol'];
	const event = await fetchArticleByIdentifier(meta.pubkey, meta.identifier, relays);
	return { event, meta };
}

export { decodeNaddr };
