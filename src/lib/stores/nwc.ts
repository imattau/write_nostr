import { writable, get } from 'svelte/store';
import { nip47, nip04, SimplePool, finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';

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

function restoreState(): NwcState {
	try {
		const stored = localStorage.getItem('write_nwc_connection');
		if (!stored) return empty;
		const parsed = nip47.parseConnectionString(stored);
		return {
			connected: true,
			connectionString: stored,
			walletPubkey: parsed.pubkey,
			relay: parsed.relays[0],
			balance: null
		};
	} catch {
		localStorage.removeItem('write_nwc_connection');
		return empty;
	}
}

function makeNwcRequest(method: string, params: Record<string, string>) {
	return async (): Promise<any> => {
		const stored = localStorage.getItem('write_nwc_connection');
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
	const { subscribe, set, update } = writable<NwcState>(restoreState());

	return {
		subscribe,

		connect(connectionString: string) {
			const parsed = nip47.parseConnectionString(connectionString);
			localStorage.setItem('write_nwc_connection', connectionString);
			set({
				connected: true,
				connectionString,
				walletPubkey: parsed.pubkey,
				relay: parsed.relays[0],
				balance: null
			});
		},

		disconnect() {
			localStorage.removeItem('write_nwc_connection');
			set(empty);
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
