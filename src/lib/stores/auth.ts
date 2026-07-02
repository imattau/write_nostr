import { writable, derived } from 'svelte/store';
import type { NostrEvent } from 'nostr-tools';

export type Signer = {
	type: 'extension' | 'nsec';
	pubkey: string;
	sign: (event: NostrEvent) => Promise<NostrEvent>;
};

function createAuthStore() {
	const store = writable<Signer | null>(null);

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
		return signer;
	}

	async function loginWithNsec(nsec: string): Promise<Signer> {
		const { nip19, getPublicKey, finalizeEvent } = await import('nostr-tools');
		const decoded = nip19.decode(nsec);
		if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
		const sk = decoded.data as Uint8Array;
		const pubkey = getPublicKey(sk);
		return {
			type: 'nsec',
			pubkey,
			sign: async (event: NostrEvent) => {
				const signed = finalizeEvent(event, sk);
				return signed as unknown as NostrEvent;
			}
		};
	}

	async function init() {
		const ext = await detectExtension();
		if (ext) {
			store.set(ext);
			return;
		}
		const stored = sessionStorage.getItem('nsec_encrypted');
		if (stored) {
			try {
				const signer = await loginWithNsec(stored);
				store.set(signer);
			} catch {
				sessionStorage.removeItem('nsec_encrypted');
			}
		}
	}

	function logout() {
		sessionStorage.removeItem('nsec_encrypted');
		store.set(null);
	}

	return {
		subscribe: store.subscribe,
		init,
		loginWithNsec,
		detectExtension,
		logout
	};
}

export const auth = createAuthStore();

export const pubkey = derived(auth, ($auth) => $auth?.pubkey ?? null);
export const isAuthenticated = derived(auth, ($auth) => $auth !== null);
