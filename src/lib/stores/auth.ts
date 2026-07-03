import { writable, derived } from 'svelte/store';
import type { NostrEvent } from 'nostr-tools';
import { getKeychain, storeKeychain, clearKeychain } from '$lib/tauri';
import { isTauri } from '$lib/utils/env';

export type Signer = {
	type: 'extension' | 'nsec' | 'passkey' | 'keychain';
	pubkey: string;
	sign: (event: NostrEvent) => Promise<NostrEvent>;
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
			};
			return {
				type: 'extension',
				pubkey: '',
				sign: async (event: NostrEvent) => {
					const signed = await ext.signEvent(event);
					return signed;
				}
			};
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
		const { nip19, getPublicKey, finalizeEvent } = await import('nostr-tools');
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
			}
		};
		setSigner(signer, () => {
			sk.fill(0);
		});
		sessionStorage.setItem('nsec_encrypted', nsec);
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
		sessionStorage.removeItem('nsec_encrypted');
		const signer: Signer = {
			type: 'passkey',
			pubkey: identity.pubkey,
			sign: async (event: NostrEvent) => {
				const signed = await shim.signEvent(event as any);
				return signed as unknown as NostrEvent;
			}
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
		sessionStorage.removeItem('nsec_encrypted');
		const signer: Signer = {
			type: 'passkey',
			pubkey: identity.pubkey,
			sign: async (event: NostrEvent) => {
				const signed = await shim.signEvent(event as any);
				return signed as unknown as NostrEvent;
			}
		};
		setSigner(signer, () => shim.destroy());
		return signer;
	}

	async function loginWithKeychain(): Promise<Signer | null> {
		const nsec = await getKeychain();
		if (!nsec) return null;
		try {
			return await loginWithNsec(nsec);
		} catch {
			await clearKeychain();
			return null;
		}
	}

	async function storeKeychainLogin(nsec: string): Promise<void> {
		await storeKeychain(nsec);
	}

	async function init() {
		if (isTauri()) {
			const keychainSigner = await loginWithKeychain();
			if (keychainSigner) return;
		}
		const ext = await detectExtension();
		if (ext) {
			return;
		}
		const stored = sessionStorage.getItem('nsec_encrypted');
		if (stored) {
			try {
				await loginWithNsec(stored);
			} catch {
				sessionStorage.removeItem('nsec_encrypted');
			}
		}
	}

	function logout() {
		cleanupSigner?.();
		cleanupSigner = null;
		sessionStorage.removeItem('nsec_encrypted');
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
