import type { Signer } from '$lib/stores/auth';

/**
 * Encrypts a NIP-51 private-tag array to the signer's own pubkey.
 * Prefers NIP-44; falls back to NIP-04 if that's all the signer supports.
 * Returns '' if there's nothing to encrypt or the signer has no crypto capability.
 */
export async function encryptPrivateTags(signer: Signer, tags: string[][]): Promise<string> {
	if (tags.length === 0) return '';
	const plaintext = JSON.stringify(tags);
	if (signer.nip44) return signer.nip44.encrypt(signer.pubkey, plaintext);
	if (signer.nip04) return signer.nip04.encrypt(signer.pubkey, plaintext);
	return '';
}

/**
 * Decrypts a NIP-51 event's `content` field into a private-tag array.
 * Tries NIP-44 first, then NIP-04, for interop with lists written by other clients.
 * Never throws — returns [] on empty content, missing crypto capability, or decrypt/parse failure.
 */
export async function decryptPrivateTags(signer: Signer, content: string): Promise<string[][]> {
	if (!content) return [];

	if (signer.nip44) {
		try {
			return JSON.parse(await signer.nip44.decrypt(signer.pubkey, content));
		} catch {
			// fall through to NIP-04
		}
	}

	if (signer.nip04) {
		try {
			return JSON.parse(await signer.nip04.decrypt(signer.pubkey, content));
		} catch {
			return [];
		}
	}

	return [];
}
