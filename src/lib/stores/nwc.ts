import { writable, get } from 'svelte/store';
import { nip47, nip04, SimplePool, finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import { auth, type Signer } from '$lib/stores/auth';
import { scheduleEncryptedSettingsSync } from '$lib/nostr/settingsSync';

export type NwcState = {
	connected: boolean;
	connectionString: string;
	walletPubkey: string;
	relay: string;
	balance: number | null;
};

const empty: NwcState = {
	connected: false,
	connectionString: '',
	walletPubkey: '',
	relay: '',
	balance: null
};

function accountConnectionKey(pubkey: string): string {
	return `write_nwc_connection_${pubkey}`;
}

function restoreState(connectionString: string | null): NwcState {
	try {
		if (!connectionString) return empty;
		const parsed = nip47.parseConnectionString(connectionString);
		return {
			connected: true,
			connectionString,
			walletPubkey: parsed.pubkey,
			relay: parsed.relays[0],
			balance: null
		};
	} catch {
		return empty;
	}
}

function storedConnection(): string | null {
	const signer = get(auth);
	return signer ? localStorage.getItem(accountConnectionKey(signer.pubkey)) : localStorage.getItem('write_nwc_connection');
}

function makeNwcRequest(method: string, params: Record<string, string>) {
	return async (): Promise<any> => {
		const stored = storedConnection();
		if (!stored) throw new Error('NWC not connected');
		const parsed = nip47.parseConnectionString(stored);
		const secretKey = hexToBytes(parsed.secret);
		const userPubkey = getPublicKey(secretKey);

		const content = JSON.stringify({ method, params });
		const encryptedContent = nip04.encrypt(secretKey, parsed.pubkey, content);

		const eventTemplate = {
			kind: 23194,
			created_at: Math.round(Date.now() / 1000),
			content: encryptedContent,
			tags: [['p', parsed.pubkey]],
			pubkey: userPubkey
		};
		const signed = finalizeEvent(eventTemplate, secretKey);

		const pool = new SimplePool();
		try {
			const relayUrl = parsed.relays[0];

			const response = await new Promise<any>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('NWC response timeout'));
				}, 30000);

				pool.subscribe([relayUrl], {
					kinds: [23195],
					'#e': [signed.id],
					limit: 1
				}, {
					onevent: (ev: any) => {
						clearTimeout(timeout);
						try {
							const decrypted = nip04.decrypt(secretKey, parsed.pubkey, ev.content);
							const result = JSON.parse(decrypted);
							if (result.error) {
								reject(new Error(result.error.message || 'NWC error'));
							} else {
								resolve(result.result || result);
							}
						} catch (e) {
							reject(e);
						}
					},
					oneose: () => {
						setTimeout(() => {
							reject(new Error('No NWC response received'));
						}, 10000);
					}
				});
			});

			return response;
		} finally {
			pool.destroy();
		}
	};
}

function createNwcStore() {
	const { subscribe, set, update } = writable<NwcState>(empty);
	let activePubkey: string | null = null;
	auth.subscribe((signer: Signer | null) => {
		const pubkey = signer?.pubkey ?? null;
		if (pubkey === activePubkey) return;
		activePubkey = pubkey;
		if (!pubkey) { set(empty); return; }
		let stored = localStorage.getItem(accountConnectionKey(pubkey));
		if (!stored) {
			stored = localStorage.getItem('write_nwc_connection');
			if (stored) {
				localStorage.setItem(accountConnectionKey(pubkey), stored);
				localStorage.removeItem('write_nwc_connection');
			}
		}
		set(restoreState(stored));
	});

	return {
		subscribe,

		connect(connectionString: string) {
			const parsed = nip47.parseConnectionString(connectionString);
			const signer = get(auth);
			if (signer) localStorage.setItem(accountConnectionKey(signer.pubkey), connectionString);
			else localStorage.setItem('write_nwc_connection', connectionString);
			set({
				connected: true,
				connectionString,
				walletPubkey: parsed.pubkey,
				relay: parsed.relays[0],
				balance: null
			});
			scheduleEncryptedSettingsSync(signer?.pubkey ?? null);
		},

		disconnect() {
			const signer = get(auth);
			if (signer) localStorage.removeItem(accountConnectionKey(signer.pubkey));
			else localStorage.removeItem('write_nwc_connection');
			set(empty);
			scheduleEncryptedSettingsSync(signer?.pubkey ?? null);
		},

		reloadForAccount(pubkey: string) {
		if (get(auth)?.pubkey !== pubkey) return;
		set(restoreState(localStorage.getItem(accountConnectionKey(pubkey))));
		},

		async getBalance(): Promise<number> {
			const res = await makeNwcRequest('get_balance', {})();
			const balance = typeof res.balance === 'number' ? res.balance : 0;
			update((s) => ({ ...s, balance }));
			return balance;
		},

		async payInvoice(bolt11: string): Promise<string> {
			const res = await makeNwcRequest('pay_invoice', { invoice: bolt11 })();
			return res.preimage as string;
		}
	};
}

export const nwc = createNwcStore();
