import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip04, nip44 } from 'nostr-tools';
import type { Signer } from '$lib/stores/auth';
import { encryptPrivateTags, decryptPrivateTags } from './listCrypto';

function makeSigner(overrides: Partial<Signer> = {}): Signer {
	const sk = generateSecretKey();
	const pubkey = getPublicKey(sk);
	return {
		type: 'nsec',
		pubkey,
		sign: async (event) => event,
		nip04: {
			encrypt: async (pk, plaintext) => nip04.encrypt(sk, pk, plaintext),
			decrypt: async (pk, ciphertext) => nip04.decrypt(sk, pk, ciphertext)
		},
		nip44: {
			encrypt: async (pk, plaintext) => nip44.encrypt(plaintext, nip44.getConversationKey(sk, pk)),
			decrypt: async (pk, ciphertext) => nip44.decrypt(ciphertext, nip44.getConversationKey(sk, pk))
		},
		...overrides
	};
}

describe('encryptPrivateTags / decryptPrivateTags', () => {
	it('round-trips tags through NIP-44 by default', async () => {
		const signer = makeSigner();
		const tags = [['p', 'abc123']];
		const content = await encryptPrivateTags(signer, tags);
		expect(content).not.toBe('');
		expect(await decryptPrivateTags(signer, content)).toEqual(tags);
	});

	it('returns empty string/array when there are no private tags / no content', async () => {
		const signer = makeSigner();
		expect(await encryptPrivateTags(signer, [])).toBe('');
		expect(await decryptPrivateTags(signer, '')).toEqual([]);
	});

	it('falls back to NIP-04 when the signer has no NIP-44 support', async () => {
		const signer = makeSigner({ nip44: undefined });
		const tags = [['p', 'def456']];
		const content = await encryptPrivateTags(signer, tags);
		expect(await decryptPrivateTags(signer, content)).toEqual(tags);
	});

	it('decrypts NIP-04 content for interop even when the signer also supports NIP-44', async () => {
		const signer = makeSigner();
		const tags = [['p', 'ghi789']];
		const content = await signer.nip04!.encrypt(signer.pubkey, JSON.stringify(tags));
		expect(await decryptPrivateTags(signer, content)).toEqual(tags);
	});

	it('returns empty string/array when the signer has no crypto capability', async () => {
		const signer = makeSigner({ nip04: undefined, nip44: undefined });
		expect(await encryptPrivateTags(signer, [['p', 'x']])).toBe('');
		expect(await decryptPrivateTags(signer, 'somecontent')).toEqual([]);
	});

	it('returns an empty array instead of throwing on garbage content', async () => {
		const signer = makeSigner();
		await expect(decryptPrivateTags(signer, 'not-valid-ciphertext')).resolves.toEqual([]);
	});
});
