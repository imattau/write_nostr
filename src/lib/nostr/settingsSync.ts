import { SimplePool, verifyEvent } from 'nostr-tools';
import type { NostrEvent, VerifiedEvent } from 'nostr-tools';
import { writable } from 'svelte/store';
import { get } from 'svelte/store';
import { auth, type Signer } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { DEFAULT_BLOSSOM_SERVERS, loadBlossomSettings, saveBlossomSettings } from '$lib/nostr/blossom';

const SETTINGS_KIND = 30078;
const SETTINGS_D_TAG = 'write-nostr:encrypted-settings';
const DIRTY_PREFIX = 'write_settings_sync_dirty_';
const CACHE_PREFIX = 'write_settings_sync_event_';
const INITIALIZED_PREFIX = 'write_settings_sync_initialized_';

type SettingsBundle = {
	version: 1;
	aiDrafting: { provider: 'openai' | 'groq'; apiKey: string; model: string };
	nwcConnection: string | null;
	blossomServers: string[];
};

export type SettingsSyncStatus = {
	state: 'idle' | 'syncing' | 'synced' | 'unavailable' | 'error';
	message: string;
	pubkey: string | null;
};

export const settingsSyncStatus = writable<SettingsSyncStatus>({ state: 'idle', message: '', pubkey: null });
export const settingsSyncRevision = writable(0);

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<void>>();
const publishing = new Map<string, Promise<void>>();

function dirtyKey(pubkey: string) { return `${DIRTY_PREFIX}${pubkey}`; }
function cacheKey(pubkey: string) { return `${CACHE_PREFIX}${pubkey}`; }
function initializedKey(pubkey: string) { return `${INITIALIZED_PREFIX}${pubkey}`; }
function nwcKey(pubkey: string) { return `write_nwc_connection_${pubkey}`; }

function hasExistingLocalSettings(pubkey: string): boolean {
	return Boolean(
		localStorage.getItem(`write_ai_drafting_${pubkey}`) ||
		localStorage.getItem(nwcKey(pubkey)) ||
		localStorage.getItem('write_nwc_connection') ||
		localStorage.getItem(`write_blossom_${pubkey}`)
	);
}

function readLocalBundle(pubkey: string): SettingsBundle {
	let aiDrafting: SettingsBundle['aiDrafting'] = { provider: 'openai', apiKey: '', model: 'gpt-4.1-mini' };
	try {
		const value = JSON.parse(localStorage.getItem(`write_ai_drafting_${pubkey}`) || 'null');
		if (value && (value.provider === 'openai' || value.provider === 'groq')) {
			aiDrafting = {
				provider: value.provider,
				apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
				model: typeof value.model === 'string' && value.model ? value.model : value.provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4.1-mini'
			};
		}
	} catch { /* Use safe defaults when local settings are malformed. */ }

	let nwcConnection = localStorage.getItem(nwcKey(pubkey));
	if (!nwcConnection) {
		// Migrate the older, unscoped wallet value to the first account that logs in.
		const legacy = localStorage.getItem('write_nwc_connection');
		if (legacy) {
			nwcConnection = legacy;
			localStorage.setItem(nwcKey(pubkey), legacy);
			localStorage.removeItem('write_nwc_connection');
		}
	}

	return {
		version: 1,
		aiDrafting,
		nwcConnection,
		blossomServers: loadBlossomSettings(pubkey).servers || [...DEFAULT_BLOSSOM_SERVERS]
	};
}

function validateBundle(value: unknown): SettingsBundle {
	if (!value || typeof value !== 'object') throw new Error('Encrypted settings have an invalid format.');
	const bundle = value as Partial<SettingsBundle>;
	if (bundle.version !== 1 || !bundle.aiDrafting || !Array.isArray(bundle.blossomServers)) {
		throw new Error('Encrypted settings use an unsupported format.');
	}
	if (bundle.aiDrafting.provider !== 'openai' && bundle.aiDrafting.provider !== 'groq') {
		throw new Error('Encrypted settings contain an unknown AI provider.');
	}
	if (typeof bundle.aiDrafting.apiKey !== 'string' || typeof bundle.aiDrafting.model !== 'string') {
		throw new Error('Encrypted settings contain invalid AI settings.');
	}
	if (bundle.nwcConnection !== null && typeof bundle.nwcConnection !== 'string') {
		throw new Error('Encrypted settings contain an invalid wallet connection.');
	}
	if (!bundle.blossomServers.every((server) => typeof server === 'string')) {
		throw new Error('Encrypted settings contain invalid Blossom servers.');
	}
	return bundle as SettingsBundle;
}

function applyBundle(pubkey: string, bundle: SettingsBundle): void {
	localStorage.setItem(`write_ai_drafting_${pubkey}`, JSON.stringify(bundle.aiDrafting));
	if (bundle.nwcConnection) localStorage.setItem(nwcKey(pubkey), bundle.nwcConnection);
	else localStorage.removeItem(nwcKey(pubkey));
	saveBlossomSettings(pubkey, { servers: bundle.blossomServers });
	settingsSyncRevision.update((revision) => revision + 1);
}

function createPool(signer: Signer): SimplePool {
	const pool = new SimplePool();
	pool.automaticallyAuth = () => async (template) => {
		const authEvent = await signer.sign({ ...template, pubkey: signer.pubkey } as NostrEvent);
		return authEvent as VerifiedEvent;
	};
	return pool;
}

function cachedEvent(pubkey: string): NostrEvent | null {
	try {
		const value = JSON.parse(localStorage.getItem(cacheKey(pubkey)) || 'null') as NostrEvent | null;
		return value && value.pubkey === pubkey && value.kind === SETTINGS_KIND && value.tags.some(([key, tagValue]) => key === 'd' && tagValue === SETTINGS_D_TAG) && verifyEvent(value) ? value : null;
	} catch {
		return null;
	}
}

async function findRemoteSettings(signer: Signer, pool: SimplePool): Promise<NostrEvent | null> {
	const cached = cachedEvent(signer.pubkey);
	try {
		const events = await pool.querySync(get(relays), {
			kinds: [SETTINGS_KIND], authors: [signer.pubkey], '#d': [SETTINGS_D_TAG], limit: 1
		});
		const remote = events
			.filter((event) => event.pubkey === signer.pubkey && event.kind === SETTINGS_KIND && verifyEvent(event))
			.sort((a, b) => b.created_at - a.created_at)[0] as NostrEvent | undefined;
		if (cached && (!remote || cached.created_at >= remote.created_at)) return cached;
		if (remote) return remote;
		return null;
	} catch (error) {
		if (cached) return cached;
		throw error;
	}
}

async function publishSettingsOnce(signer: Signer): Promise<void> {
	if (!signer.nip44) throw new Error('Your signer does not support NIP-44 encrypted settings sync.');
	const dirtyAt = localStorage.getItem(dirtyKey(signer.pubkey));
	const pool = createPool(signer);
	try {
		const content = await signer.nip44.encrypt(signer.pubkey, JSON.stringify(readLocalBundle(signer.pubkey)));
		const event = await signer.sign({
			kind: SETTINGS_KIND,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['d', SETTINGS_D_TAG]],
			content,
			pubkey: signer.pubkey
		} as NostrEvent);
		const results = await Promise.allSettled(pool.publish(get(relays), event));
		if (!results.some((result) => result.status === 'fulfilled')) {
			throw new Error('Could not publish encrypted settings to any relay.');
		}
		localStorage.setItem(cacheKey(signer.pubkey), JSON.stringify(event));
		if (localStorage.getItem(dirtyKey(signer.pubkey)) === dirtyAt) localStorage.removeItem(dirtyKey(signer.pubkey));
	} finally {
		pool.destroy();
	}
}

function publishSettings(signer: Signer): Promise<void> {
	const existing = publishing.get(signer.pubkey);
	if (existing) {
		return existing.then(() => localStorage.getItem(dirtyKey(signer.pubkey)) ? publishSettings(signer) : undefined);
	}
	const task = publishSettingsOnce(signer).finally(() => publishing.delete(signer.pubkey));
	publishing.set(signer.pubkey, task);
	return task;
}

async function initialize(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer || signer.pubkey !== pubkey) return;
	if (!signer.nip44) {
		settingsSyncStatus.set({ state: 'unavailable', pubkey, message: 'Your signer does not support NIP-44 encrypted settings sync.' });
		return;
	}
	settingsSyncStatus.set({ state: 'syncing', pubkey, message: 'Syncing encrypted settings…' });
	const firstSync = !localStorage.getItem(initializedKey(pubkey));
	const preserveLocalSettings = firstSync && hasExistingLocalSettings(pubkey);
	const pending = pendingTimers.get(pubkey);
	if (pending) { clearTimeout(pending); pendingTimers.delete(pubkey); }
	const pool = createPool(signer);
	let synced = false;
	try {
		const remote = await findRemoteSettings(signer, pool);
		const dirtyAt = Number(localStorage.getItem(dirtyKey(pubkey)) || '0');
		if (remote && dirtyAt >= remote.created_at * 1000) {
			await publishSettings(signer);
		} else if (preserveLocalSettings && remote) {
			// On first sync, preserve fields already configured on this device while retaining
			// remote-only fields. This protects pre-sync settings without discarding another device's data.
			const plaintext = await signer.nip44.decrypt(signer.pubkey, remote.content);
			const remoteBundle = validateBundle(JSON.parse(plaintext));
			const localBundle = readLocalBundle(pubkey);
			const mergedBundle: SettingsBundle = {
				...remoteBundle,
				aiDrafting: localStorage.getItem(`write_ai_drafting_${pubkey}`) ? localBundle.aiDrafting : remoteBundle.aiDrafting,
				nwcConnection: localStorage.getItem(nwcKey(pubkey)) || localStorage.getItem('write_nwc_connection')
					? localBundle.nwcConnection : remoteBundle.nwcConnection,
				blossomServers: localStorage.getItem(`write_blossom_${pubkey}`) ? localBundle.blossomServers : remoteBundle.blossomServers
			};
			applyBundle(pubkey, mergedBundle);
			localStorage.setItem(dirtyKey(pubkey), String(Date.now()));
			await publishSettings(signer);
		} else if (preserveLocalSettings) {
			// Existing local settings predate sync, so publish them when there is no remote copy.
			await publishSettings(signer);
		} else if (remote) {
			const plaintext = await signer.nip44.decrypt(signer.pubkey, remote.content);
			const latestDirtyAt = Number(localStorage.getItem(dirtyKey(pubkey)) || '0');
			if (latestDirtyAt >= remote.created_at * 1000) {
				await publishSettings(signer);
			} else {
				applyBundle(pubkey, validateBundle(JSON.parse(plaintext)));
				localStorage.setItem(cacheKey(pubkey), JSON.stringify(remote));
				localStorage.removeItem(dirtyKey(pubkey));
			}
		} else {
			await publishSettings(signer);
		}
		localStorage.setItem(initializedKey(pubkey), '1');
		settingsSyncStatus.set({ state: 'synced', pubkey, message: 'Encrypted settings synced.' });
		synced = true;
	} catch (error) {
		settingsSyncStatus.set({ state: 'error', pubkey, message: error instanceof Error ? error.message : 'Could not sync encrypted settings.' });
	} finally {
		pool.destroy();
		if (synced && localStorage.getItem(dirtyKey(pubkey)) && get(auth)?.pubkey === pubkey) {
			scheduleEncryptedSettingsSync(pubkey);
		}
	}
}

export function initializeEncryptedSettingsSync(pubkey: string): Promise<void> {
	const existing = inFlight.get(pubkey);
	if (existing) return existing;
	const task = initialize(pubkey).finally(() => inFlight.delete(pubkey));
	inFlight.set(pubkey, task);
	return task;
}

export function scheduleEncryptedSettingsSync(pubkey: string | null): void {
	if (!pubkey || typeof localStorage === 'undefined') return;
	localStorage.setItem(dirtyKey(pubkey), String(Date.now()));
	const current = pendingTimers.get(pubkey);
	if (current) clearTimeout(current);
	settingsSyncStatus.set({ state: 'syncing', pubkey, message: 'Encrypted settings will sync shortly…' });
	pendingTimers.set(pubkey, setTimeout(() => {
		pendingTimers.delete(pubkey);
		if (inFlight.has(pubkey)) return;
		const signer = get(auth);
		if (!signer || signer.pubkey !== pubkey) return;
		publishSettings(signer).then(() => {
			settingsSyncStatus.set({ state: 'synced', pubkey, message: 'Encrypted settings synced.' });
		}).catch((error) => {
			settingsSyncStatus.set({ state: 'error', pubkey, message: error instanceof Error ? error.message : 'Could not sync encrypted settings.' });
		});
	}, 1000));
}
