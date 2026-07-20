import { writable, derived } from 'svelte/store';
import { nip19, getPublicKey, finalizeEvent, nip04, nip44 } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { getKeychain, storeKeychain, clearKeychain } from '$lib/tauri';
import { isTauri } from '$lib/utils/env';

export type CryptoMethods = {
	encrypt(pubkey: string, plaintext: string): Promise<string>;
	decrypt(pubkey: string, ciphertext: string): Promise<string>;
};

export type Signer = {
	type: 'extension' | 'nsec' | 'passkey' | 'keychain';
	pubkey: string;
	sign: (event: NostrEvent) => Promise<NostrEvent>;
	nip04?: CryptoMethods;
	nip44?: CryptoMethods;
};

function createAuthStore() {
	const store = writable<Signer | null>(null);
	let cleanupSigner: (() => void) | null = null;

	function setSigner(signer: Signer, cleanup?: () => void) {
		cleanupSigner?.();
		cleanupSigner = cleanup ?? null;
		store.set(signer);
	}

	function getNip07Signer(): Signer | null {
		const win = window as unknown as Record<string, unknown>;
		if (typeof win.nostr === 'object' && win.nostr !== null) {
			const ext = win.nostr as {
				getPublicKey: () => Promise<string>;
				signEvent: (event: NostrEvent) => Promise<NostrEvent>;
				nip04?: CryptoMethods;
				nip44?: CryptoMethods;
			};
			const signer: Signer = {
				type: 'extension',
				pubkey: '',
				sign: async (event: NostrEvent) => {
					const signed = await ext.signEvent(event);
					return signed;
				}
			};
			if (ext.nip04) signer.nip04 = ext.nip04;
			if (ext.nip44) signer.nip44 = ext.nip44;
			return signer;
		}
		return null;
	}

	async function detectExtension(): Promise<Signer | null> {
		const signer = getNip07Signer();
		if (!signer) return null;
		const win = window as unknown as { nostr: { getPublicKey: () => Promise<string> } };
		signer.pubkey = await win.nostr.getPublicKey();
		setSigner(signer);
		return signer;
	}

	async function loginWithNsec(nsec: string): Promise<Signer> {
		const decoded = nip19.decode(nsec);
		if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
		const sk = decoded.data as Uint8Array;
		const pubkey = getPublicKey(sk);
		const signer: Signer = {
			type: 'nsec',
			pubkey,
			sign: async (event: NostrEvent) => {
				const signed = finalizeEvent(event, sk);
				return signed as unknown as NostrEvent;
			},
			nip04: {
				encrypt: async (pk, plaintext) => nip04.encrypt(sk, pk, plaintext),
				decrypt: async (pk, ciphertext) => nip04.decrypt(sk, pk, ciphertext)
			},
			nip44: {
				encrypt: async (pk, plaintext) => nip44.encrypt(plaintext, nip44.getConversationKey(sk, pk)),
				decrypt: async (pk, ciphertext) => nip44.decrypt(ciphertext, nip44.getConversationKey(sk, pk))
			}
		};
		setSigner(signer, () => {
			sk.fill(0);
		});
		// WARNING: The nsec is stored in plaintext. sessionStorage is cleared on tab close
		// but is accessible to any JS running in the same origin (e.g. extensions, devtools).
		sessionStorage.setItem('nsec_raw', nsec);
		return signer;
	}

	async function loginWithPasskey(): Promise<Signer> {
		const { buildPasskeySignerShim, isPRFSupported, unlockPasskeyIdentity } =
			await import('nostr-passkey');

		if (!(await isPRFSupported())) {
			throw new Error('Passkeys are not supported in this browser');
		}

		const identity = await unlockPasskeyIdentity(undefined, {
			rpName: 'write_nostr'
		});
		const shim = buildPasskeySignerShim(identity.secretKey);
		sessionStorage.removeItem('nsec_raw');
		const signer: Signer = {
			type: 'passkey',
			pubkey: identity.pubkey,
			sign: async (event: NostrEvent) => {
				const signed = await shim.signEvent(event as any);
				return signed as unknown as NostrEvent;
			},
			nip04: shim.nip04,
			nip44: shim.nip44
		};
		setSigner(signer, () => shim.destroy());
		return signer;
	}

	async function importPasskeyFromNsec(nsec: string): Promise<Signer> {
		const { buildPasskeySignerShim, importPasskeyIdentityFromNsec, isPRFSupported } =
			await import('nostr-passkey');

		if (!(await isPRFSupported())) {
			throw new Error('Passkeys are not supported in this browser');
		}

		const identity = await importPasskeyIdentityFromNsec(nsec, {
			rpName: 'write_nostr'
		});
		const shim = buildPasskeySignerShim(identity.secretKey);
		sessionStorage.removeItem('nsec_raw');
		const signer: Signer = {
			type: 'passkey',
			pubkey: identity.pubkey,
			sign: async (event: NostrEvent) => {
				const signed = await shim.signEvent(event as any);
				return signed as unknown as NostrEvent;
			},
			nip04: shim.nip04,
			nip44: shim.nip44
		};
		setSigner(signer, () => shim.destroy());
		return signer;
	}

	async function loginWithKeychain(): Promise<Signer | null> {
		try {
			const nsec = await getKeychain();
			if (!nsec) return null;
			return await loginWithNsec(nsec);
		} catch {
			await clearKeychain().catch(() => {});
			return null;
		}
	}

	async function storeKeychainLogin(nsec: string): Promise<void> {
		await storeKeychain(nsec);
	}

	async function init() {
		try {
			if (isTauri()) {
				const keychainSigner = await loginWithKeychain();
				if (keychainSigner) return;
			}
			const ext = await detectExtension();
			if (ext) return;
			const stored = sessionStorage.getItem('nsec_raw');
			if (stored) {
				await loginWithNsec(stored);
			}
		} catch (e) {
			console.warn('[auth] init error:', e);
		}
	}

	function logout() {
		cleanupSigner?.();
		cleanupSigner = null;
		sessionStorage.removeItem('nsec_raw');
		store.set(null);
	}

	return {
		subscribe: store.subscribe,
		init,
		loginWithNsec,
		loginWithKeychain,
		storeKeychainLogin,
		detectExtension,
		loginWithPasskey,
		importPasskeyFromNsec,
		logout
	};
}

export const auth = createAuthStore();

export const pubkey = derived(auth, ($auth) => $auth?.pubkey ?? null);
export const isAuthenticated = derived(auth, ($auth) => $auth !== null);
