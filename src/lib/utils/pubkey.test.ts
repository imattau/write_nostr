import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { parsePubkeyInput } from './pubkey';

describe('parsePubkeyInput', () => {
	it('decodes npubs to lowercase hex', () => {
		const pubkey = getPublicKey(generateSecretKey());
		const npub = nip19.npubEncode(pubkey);
		expect(parsePubkeyInput(npub)).toBe(pubkey);
		expect(parsePubkeyInput(npub.toUpperCase())).toBe(pubkey);
	});

	it('accepts valid hex and rejects malformed or wrong NIP-19 identifiers', () => {
		const pubkey = 'A'.repeat(64);
		expect(parsePubkeyInput(`  ${pubkey}  `)).toBe(pubkey.toLowerCase());
		expect(() => parsePubkeyInput('npub1invalid')).toThrow('valid npub');
		expect(() => parsePubkeyInput('not-a-pubkey')).toThrow('valid npub');
	});
});
