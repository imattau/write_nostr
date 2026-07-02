import { nip19 } from 'nostr-tools';

export type NaddrParts = {
	pubkey: string;
	identifier: string;
	relays?: string[];
};

export function decodeNaddr(bech32: string): NaddrParts | null {
	try {
		const decoded = nip19.decode(bech32);
		if (decoded.type === 'naddr') {
			const data = decoded.data as { pubkey: string; identifier: string; relays?: string[] };
			return { pubkey: data.pubkey, identifier: data.identifier, relays: data.relays };
		}
		return null;
	} catch {
		return null;
	}
}

export function encodeNaddr(pubkey: string, identifier: string, relays?: string[]): string {
	return nip19.naddrEncode({ pubkey, identifier, relays, kind: 30023 });
}
