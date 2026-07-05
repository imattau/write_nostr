import { writable, get } from 'svelte/store';
import { fetchRelayList } from '$lib/nostr/fetch';

export const DEFAULT_RELAYS = [
	'wss://relay.damus.io',
	'wss://relay.nostr.band',
	'wss://nos.lol',
	'wss://relay.primal.net'
];

const _loadingRelays = writable(false);
/** True while the user's Nostr relay list is being fetched. */
export const loadingRelays = { subscribe: _loadingRelays.subscribe };

function storageKey(pubkey: string) {
	return `write_relays_${pubkey}`;
}

function createRelaysStore() {
	// Bootstrap from localStorage (no pubkey yet → use the generic key or defaults)
	// SSR guard: localStorage is not available in Node.js (SvelteKit SSR)
	const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('write_relays') : null;
	const initial: string[] = stored ? JSON.parse(stored) : DEFAULT_RELAYS;
	const { subscribe, set, update } = writable<string[]>(initial);

	return {
		subscribe,

		add(url: string) {
			update((r) => {
				if (r.includes(url)) return r;
				const next = [...r, url];
				// Persist under whatever key is currently active
				const activeKey = localStorage.getItem('write_relays_active_key') ?? 'write_relays';
				localStorage.setItem(activeKey, JSON.stringify(next));
				return next;
			});
		},

		remove(url: string) {
			update((r) => {
				const next = r.filter((u) => u !== url);
				const activeKey = localStorage.getItem('write_relays_active_key') ?? 'write_relays';
				localStorage.setItem(activeKey, JSON.stringify(next));
				return next;
			});
		},

		reset() {
			const activeKey = localStorage.getItem('write_relays_active_key') ?? 'write_relays';
			localStorage.setItem(activeKey, JSON.stringify(DEFAULT_RELAYS));
			set(DEFAULT_RELAYS);
		},

		/**
		 * After login, fetch the user's relay list from Nostr (NIP-65 kind:10002,
		 * fallback to kind:3 relay hints). If relays are found they replace the
		 * current list; if nothing is found the existing list is left untouched.
		 */
		async loadFromNostr(pubkey: string) {
			_loadingRelays.set(true);
			try {
				// Use the current store value as bootstrap relays for the lookup
				const bootstrap = get({ subscribe });

				// Check if we already have a saved list for this pubkey
				const key = storageKey(pubkey);
				localStorage.setItem('write_relays_active_key', key);

				const saved = localStorage.getItem(key);
				if (saved) {
					set(JSON.parse(saved));
					return;
				}

				// Fetch from Nostr
				const fetched = await fetchRelayList(pubkey, bootstrap);
				if (fetched.length > 0) {
					localStorage.setItem(key, JSON.stringify(fetched));
					set(fetched);
				}
				// else: leave the current (default) list in place
			} catch (err) {
				console.warn('[relays] Could not load relay list from Nostr:', err);
			} finally {
				_loadingRelays.set(false);
			}
		}
	};
}

export const relays = createRelaysStore();
