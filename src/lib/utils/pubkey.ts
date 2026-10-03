import { nip19 } from 'nostr-tools';

/** Accept an npub or 32-byte hex public key and return canonical lowercase hex. */
export function parsePubkeyInput(input: string): string {
	const value = input.trim();
	if (/^npub1/i.test(value)) {
		try {
			const decoded = nip19.decode(value.toLowerCase());
			if (decoded.type === 'npub' && typeof decoded.data === 'string' && /^[0-9a-f]{64}$/i.test(decoded.data)) {
				return decoded.data.toLowerCase();
			}
		} catch {
			// Normalize invalid npub forms to the same clear input error below.
		}
	}
	if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
	throw new Error('Enter a valid npub or 64-character hex public key.');
}
