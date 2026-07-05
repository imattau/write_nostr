# NIP-51 Public/Private List Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public+private support for NIP-51 lists (mute, bookmarks, pins, categorized people lists) to the write_nostr app, backed by a shared signer-encryption and generic-list infrastructure.

**Architecture:** Extend the `Signer` type with optional NIP-04/NIP-44 encrypt/decrypt capability (implemented per signer backend), build one generic list-fetch/publish module that any NIP-51 list kind can wrap, then layer domain-specific stores (mute, bookmarks, pins, categorized) and a unified `/lists` UI page on top.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), TypeScript, `nostr-tools` (nip04/nip44/SimplePool), `nostr-passkey`, Vitest (new).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-nip51-private-lists-design.md`
- New encrypted writes use NIP-44; decrypt tries NIP-44 first, then falls back to NIP-04 (per spec Architecture §1 and §2).
- Quick inline actions (mute/bookmark/pin buttons) default new entries to `private: true` (per spec §4).
- Decrypt failures or signers without crypto capability must degrade gracefully — never throw and block a list from rendering its public entries (per spec Error Handling).
- Kind `3` (follow list) is out of scope — untouched by this work.
- No unrelated refactors — `social.ts`'s follow-list (`kind: 3`) logic stays as-is; only its mute-list half is replaced.

---

### Task 1: Add Vitest test runner

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm test` script running Vitest once; test files matched by `src/**/*.{test,spec}.ts`.

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'node',
		include: ['src/**/*.{test,spec}.ts']
	}
});
```

- [ ] **Step 3: Add the `test` script**

Modify `package.json`'s `"scripts"` block — add after `"check:watch"`:

```json
		"test": "vitest run",
```

- [ ] **Step 4: Verify the runner works with a throwaway smoke test**

Create `src/lib/smoke.test.ts` temporarily:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest smoke test', () => {
	it('runs', () => {
		expect(1 + 1).toBe(2);
	});
});
```

Run: `npm test`
Expected: `1 passed`

Delete `src/lib/smoke.test.ts` once confirmed.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "test: add Vitest test runner"
```

---

### Task 2: Signer encryption capability — nsec/keychain

**Files:**
- Modify: `src/lib/stores/auth.ts:1-69` (imports and `loginWithNsec`)

**Interfaces:**
- Produces: `Signer` type gains `nip04?: CryptoMethods` and `nip44?: CryptoMethods`, where `CryptoMethods = { encrypt(pubkey: string, plaintext: string): Promise<string>; decrypt(pubkey: string, ciphertext: string): Promise<string> }`. Any signer created via `loginWithNsec` (and therefore `loginWithKeychain`, which delegates to it) has both populated.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Add the `CryptoMethods` type and extend `Signer`**

Modify `src/lib/stores/auth.ts`, replacing the `Signer` type definition (currently lines 6-10):

```ts
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
```

- [ ] **Step 2: Implement nip04/nip44 for the nsec signer**

Modify `loginWithNsec` in `src/lib/stores/auth.ts` (currently lines 50-69):

```ts
	async function loginWithNsec(nsec: string): Promise<Signer> {
		const { nip19, getPublicKey, finalizeEvent, nip04, nip44 } = await import('nostr-tools');
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
		sessionStorage.setItem('nsec_encrypted', nsec);
		return signer;
	}
```

(No changes needed to `loginWithKeychain` — it calls `loginWithNsec` and inherits the new fields.)

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/auth.ts
git commit -m "feat: add NIP-04/NIP-44 encryption to nsec/keychain signer"
```

---

### Task 3: Signer encryption capability — passkey

**Files:**
- Modify: `src/lib/stores/auth.ts` (`loginWithPasskey`, `importPasskeyFromNsec`)

**Interfaces:**
- Consumes: `CryptoMethods`, `Signer` from Task 2.
- Produces: passkey signers have `nip04`/`nip44` populated by delegating to `nostr-passkey`'s shim, which already implements both (confirmed in `node_modules/nostr-passkey/dist/index.d.ts:41-48`, same `(pubkey, plaintext/ciphertext)` argument order as `CryptoMethods`).

- [ ] **Step 1: Wire the shim's crypto methods into the passkey signer**

Modify `loginWithPasskey` in `src/lib/stores/auth.ts` (currently lines 71-94), adding `nip04`/`nip44` to the returned `Signer`:

```ts
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
			},
			nip04: shim.nip04,
			nip44: shim.nip44
		};
		setSigner(signer, () => shim.destroy());
		return signer;
	}
```

- [ ] **Step 2: Same wiring for `importPasskeyFromNsec`**

Modify `importPasskeyFromNsec` in `src/lib/stores/auth.ts` (currently lines 96-119), same addition:

```ts
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
			},
			nip04: shim.nip04,
			nip44: shim.nip44
		};
		setSigner(signer, () => shim.destroy());
		return signer;
	}
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/auth.ts
git commit -m "feat: add NIP-04/NIP-44 encryption to passkey signer"
```

---

### Task 4: Signer encryption capability — browser extension (NIP-07)

**Files:**
- Modify: `src/lib/stores/auth.ts` (`getNip07Signer`)

**Interfaces:**
- Consumes: `CryptoMethods`, `Signer` from Task 2.
- Produces: extension signers have `nip04`/`nip44` populated only when `window.nostr.nip04`/`window.nostr.nip44` exist (feature-detected); otherwise the fields stay `undefined`.

- [ ] **Step 1: Feature-detect and attach extension crypto methods**

Modify `getNip07Signer` in `src/lib/stores/auth.ts` (currently lines 22-39):

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/auth.ts
git commit -m "feat: feature-detect NIP-04/NIP-44 on NIP-07 extension signer"
```

---

### Task 5: Pure list-crypto helpers (with tests)

**Files:**
- Create: `src/lib/nostr/listCrypto.ts`
- Test: `src/lib/nostr/listCrypto.test.ts`

**Interfaces:**
- Consumes: `Signer`, `CryptoMethods` from `src/lib/stores/auth.ts` (Tasks 2-4).
- Produces:
  - `encryptPrivateTags(signer: Signer, tags: string[][]): Promise<string>`
  - `decryptPrivateTags(signer: Signer, content: string): Promise<string[][]>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/nostr/listCrypto.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- listCrypto`
Expected: FAIL — `Cannot find module './listCrypto'` (file doesn't exist yet).

- [ ] **Step 3: Implement `listCrypto.ts`**

Create `src/lib/nostr/listCrypto.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- listCrypto`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/nostr/listCrypto.ts src/lib/nostr/listCrypto.test.ts
git commit -m "feat: add NIP-51 private-tag encrypt/decrypt helpers"
```

---

### Task 6: Generic NIP-51 list module (with tests)

**Files:**
- Create: `src/lib/nostr/lists.ts`
- Test: `src/lib/nostr/lists.test.ts`

**Interfaces:**
- Consumes: `Signer` (auth.ts), `encryptPrivateTags`/`decryptPrivateTags` (Task 5).
- Produces:
  - `type ListEntry = { tag: string[]; private: boolean }`
  - `type ListSpec = { kind: number; dTag?: string }`
  - `tagsToEntries(publicTags: string[][], privateTags: string[][]): ListEntry[]` (pure)
  - `entriesToTags(entries: ListEntry[], dTag?: string): { publicTags: string[][]; privateTags: string[][] }` (pure)
  - `loadList(signer: Signer, relayList: string[], spec: ListSpec): Promise<ListEntry[]>`
  - `saveList(signer: Signer, relayList: string[], spec: ListSpec, entries: ListEntry[]): Promise<void>`

- [ ] **Step 1: Write the failing tests for the pure helpers**

Create `src/lib/nostr/lists.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tagsToEntries, entriesToTags } from './lists';

describe('tagsToEntries', () => {
	it('marks public tags as not private and private tags as private, public first', () => {
		const result = tagsToEntries([['p', 'a']], [['p', 'b']]);
		expect(result).toEqual([
			{ tag: ['p', 'a'], private: false },
			{ tag: ['p', 'b'], private: true }
		]);
	});

	it('handles empty inputs', () => {
		expect(tagsToEntries([], [])).toEqual([]);
	});
});

describe('entriesToTags', () => {
	it('splits entries by privacy', () => {
		const entries = [
			{ tag: ['p', 'a'], private: false },
			{ tag: ['p', 'b'], private: true }
		];
		expect(entriesToTags(entries)).toEqual({
			publicTags: [['p', 'a']],
			privateTags: [['p', 'b']]
		});
	});

	it('prepends a d tag to the public tags when dTag is given', () => {
		const entries = [{ tag: ['p', 'a'], private: false }];
		expect(entriesToTags(entries, 'friends')).toEqual({
			publicTags: [['d', 'friends'], ['p', 'a']],
			privateTags: []
		});
	});

	it('omits the d tag when dTag is undefined', () => {
		const entries = [{ tag: ['p', 'a'], private: false }];
		expect(entriesToTags(entries)).toEqual({
			publicTags: [['p', 'a']],
			privateTags: []
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lists.test`
Expected: FAIL — `tagsToEntries`/`entriesToTags` not exported (file doesn't exist yet).

- [ ] **Step 3: Implement `lists.ts`**

Create `src/lib/nostr/lists.ts`:

```ts
import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import type { Signer } from '$lib/stores/auth';
import { encryptPrivateTags, decryptPrivateTags } from './listCrypto';

export type ListEntry = { tag: string[]; private: boolean };

export type ListSpec = {
	kind: number;
	/** Required for parameterized-replaceable lists (e.g. kind 30000). */
	dTag?: string;
};

/** Pure: merges decrypted public/private tag arrays into one ordered ListEntry[] (public first). */
export function tagsToEntries(publicTags: string[][], privateTags: string[][]): ListEntry[] {
	return [
		...publicTags.map((tag) => ({ tag, private: false as const })),
		...privateTags.map((tag) => ({ tag, private: true as const }))
	];
}

/** Pure: splits entries into public/private tag arrays, prepending a d tag to public tags if given. */
export function entriesToTags(
	entries: ListEntry[],
	dTag?: string
): { publicTags: string[][]; privateTags: string[][] } {
	const publicTags = entries.filter((e) => !e.private).map((e) => e.tag);
	const privateTags = entries.filter((e) => e.private).map((e) => e.tag);
	return {
		publicTags: dTag !== undefined ? [['d', dTag], ...publicTags] : publicTags,
		privateTags
	};
}

/** Fetches a NIP-51 list event for the signer's own pubkey and merges its public+private tags. */
export async function loadList(
	signer: Signer,
	relayList: string[],
	spec: ListSpec
): Promise<ListEntry[]> {
	const pool = new SimplePool();
	try {
		const filter: Record<string, unknown> = {
			kinds: [spec.kind],
			authors: [signer.pubkey],
			limit: 1
		};
		if (spec.dTag !== undefined) filter['#d'] = [spec.dTag];

		const events = await pool.querySync(relayList, filter as Parameters<typeof pool.querySync>[1]);
		const event = events.sort((a, b) => b.created_at - a.created_at)[0];
		if (!event) return [];

		const publicTags = event.tags.filter(([key]) => key !== 'd');
		const privateTags = await decryptPrivateTags(signer, event.content);
		return tagsToEntries(publicTags, privateTags);
	} finally {
		pool.destroy();
	}
}

/** Builds, signs, and publishes a NIP-51 list event from a full entry set (replaces the whole list). */
export async function saveList(
	signer: Signer,
	relayList: string[],
	spec: ListSpec,
	entries: ListEntry[]
): Promise<void> {
	const { publicTags, privateTags } = entriesToTags(entries, spec.dTag);
	const content = await encryptPrivateTags(signer, privateTags);

	const event: NostrEvent = {
		kind: spec.kind,
		created_at: Math.floor(Date.now() / 1000),
		tags: publicTags,
		content,
		pubkey: signer.pubkey
	} as NostrEvent;

	const signed = await signer.sign(event);
	const pool = new SimplePool();
	try {
		await Promise.allSettled(pool.publish(relayList, signed));
	} finally {
		pool.destroy();
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lists.test`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/nostr/lists.ts src/lib/nostr/lists.test.ts
git commit -m "feat: add generic NIP-51 list load/save module"
```

---

### Task 7: Refactor mute list to use the generic module, with privacy support

**Files:**
- Modify: `src/lib/stores/social.ts`

**Interfaces:**
- Consumes: `loadList`, `saveList`, `ListEntry` from Task 6.
- Produces:
  - `blockedPubkeys` store keeps its existing shape (`Set<string>`, all known blocked pubkeys regardless of privacy) — no consumer-facing break for `ArticleCard`/`+page.svelte`, which only read `.has()`.
  - `blockUser(pubkey: string, opts?: { private?: boolean }): Promise<void>` — `private` defaults to `false` (existing quick-action callers keep current public behavior unless updated in Task 11).
  - `unblockUser(pubkey: string): Promise<void>` — unchanged signature.
  - New export: `blockedEntries` derived store of `ListEntry[]` (tag + private flag) for the Lists page (Task 9) to render with privacy toggles.

- [ ] **Step 1: Replace the mute-list half of `social.ts`**

Modify `src/lib/stores/social.ts` in full (the kind:3 follow-list logic is untouched; only the kind:10000 mute-list logic changes):

```ts
import { writable, derived, get } from 'svelte/store';
import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { loadList, saveList, type ListEntry } from '$lib/nostr/lists';

// ── Internal state ─────────────────────────────────────────────────────────

/** Pubkeys the current user follows (NIP-02 kind:3) */
const followedPubkeys = writable<Set<string>>(new Set());

/** NIP-51 mute-list entries (kind:10000), public + private, as loaded from relays */
const blockedListEntries = writable<ListEntry[]>([]);

let followEventTags: string[][] = []; // full tag list from last kind:3 event

// ── Public derived stores ──────────────────────────────────────────────────

export const follows = derived(followedPubkeys, ($f) => $f);

/** All muted pubkeys (public + private) as a Set, for quick membership checks. */
export const blocks = derived(blockedListEntries, ($entries) => new Set($entries.map((e) => e.tag[1])));

/** Mute-list entries with their privacy flag, for list-management UI. */
export const blockedEntries = derived(blockedListEntries, ($e) => $e);

// ── Bootstrap: load lists from relays ─────────────────────────────────────

export async function loadSocialLists(): Promise<void> {
	const signer = get(auth);
	if (!signer) return;

	const relayList = get(relays);
	const pool = new SimplePool();

	try {
		const events = await pool.querySync(relayList, {
			kinds: [3],
			authors: [signer.pubkey],
			limit: 1
		});

		// kind:3 – contact list (follows)
		const followEvent = events.sort((a, b) => b.created_at - a.created_at)[0];

		if (followEvent) {
			followEventTags = followEvent.tags;
			followedPubkeys.set(
				new Set(
					followEvent.tags.filter(([k]) => k === 'p').map(([, pk]) => pk)
				)
			);
		}
	} finally {
		pool.destroy();
	}

	// kind:10000 – mute/block list (public + private)
	const entries = await loadList(signer, relayList, { kind: 10000 });
	blockedListEntries.set(entries);
}

// ── Follow ─────────────────────────────────────────────────────────────────

export async function followUser(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	// Optimistic update
	followedPubkeys.update((s) => new Set([...s, pubkey]));

	// Build new tag list (keep existing non-p tags + existing follows + new one)
	const existingPTags = followEventTags.filter(([k]) => k === 'p');
	const alreadyPresent = existingPTags.some(([, pk]) => pk === pubkey);
	const newPTag: string[] = ['p', pubkey];
	const newTags = alreadyPresent
		? followEventTags
		: [
				...followEventTags.filter(([k]) => k !== 'p'),
				...existingPTags,
				newPTag
			];

	followEventTags = newTags;
	await publishFollowList(newTags);
}

export async function unfollowUser(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	// Optimistic update
	followedPubkeys.update((s) => {
		const next = new Set(s);
		next.delete(pubkey);
		return next;
	});

	const newTags = followEventTags.filter(([k, pk]) => !(k === 'p' && pk === pubkey));
	followEventTags = newTags;
	await publishFollowList(newTags);
}

// ── Block ──────────────────────────────────────────────────────────────────

export async function blockUser(pubkey: string, opts: { private?: boolean } = {}): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const isPrivate = opts.private ?? false;

	// Optimistic update
	blockedListEntries.update((entries) => {
		if (entries.some((e) => e.tag[1] === pubkey)) return entries;
		return [...entries, { tag: ['p', pubkey], private: isPrivate }];
	});

	const newEntries = get(blockedListEntries);
	await saveList(signer, get(relays), { kind: 10000 }, newEntries);
}

export async function unblockUser(pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	// Optimistic update
	blockedListEntries.update((entries) => entries.filter((e) => e.tag[1] !== pubkey));

	const newEntries = get(blockedListEntries);
	await saveList(signer, get(relays), { kind: 10000 }, newEntries);
}

/** Sets an existing mute-list entry's privacy flag and republishes the list. Used by the Lists page. */
export async function setBlockedEntryPrivacy(pubkey: string, isPrivate: boolean): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	blockedListEntries.update((entries) =>
		entries.map((e) => (e.tag[1] === pubkey ? { ...e, private: isPrivate } : e))
	);

	const newEntries = get(blockedListEntries);
	await saveList(signer, get(relays), { kind: 10000 }, newEntries);
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function publishFollowList(tags: string[][]): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const event: NostrEvent = {
		kind: 3,
		created_at: Math.floor(Date.now() / 1000),
		tags,
		content: '',
		pubkey: signer.pubkey
	} as NostrEvent;

	const signed = await signer.sign(event);
	const relayList = get(relays);
	const pool = new SimplePool();
	try {
		await Promise.allSettled(pool.publish(relayList, signed));
	} finally {
		pool.destroy();
	}
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no new errors. (`ArticleCard.svelte` and `+page.svelte` only consume `blocks`, `blockUser`, `unblockUser`, `followUser`, `unfollowUser`, `loadSocialLists`, `follows` — all still present with compatible signatures.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/social.ts
git commit -m "refactor: back mute list with generic NIP-51 module, add private-entry support"
```

---

### Task 8: Bookmarks and Pins stores

**Files:**
- Create: `src/lib/stores/bookmarks.ts`
- Create: `src/lib/stores/pins.ts`

**Interfaces:**
- Consumes: `loadList`, `saveList`, `ListEntry` (Task 6), `auth`, `relays`.
- Produces (identical shape for both, kinds `10003` and `10001` respectively):
  - `{name}Entries` derived store of `ListEntry[]` (tag = `['a', coordinate]`)
  - `is{Name}ed(coordinate: string): boolean` — not exported as a function; instead a derived `Set<string>` of coordinates, mirroring `blocks` in social.ts:
    - `bookmarkedCoordinates: Readable<Set<string>>`
    - `pinnedCoordinates: Readable<Set<string>>`
  - `add{Name}(coordinate: string, opts?: { private?: boolean }): Promise<void>`
  - `remove{Name}(coordinate: string): Promise<void>`
  - `set{Name}EntryPrivacy(coordinate: string, isPrivate: boolean): Promise<void>`
  - `load{Name}s(): Promise<void>`

- [ ] **Step 1: Create `bookmarks.ts`**

Create `src/lib/stores/bookmarks.ts`:

```ts
import { writable, derived, get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { loadList, saveList, type ListEntry } from '$lib/nostr/lists';

const BOOKMARKS_KIND = 10003;

const bookmarkListEntries = writable<ListEntry[]>([]);

/** Bookmark entries (article coordinates) with their privacy flag, for list-management UI. */
export const bookmarkEntries = derived(bookmarkListEntries, ($e) => $e);

/** Bookmarked article coordinates (public + private) as a Set, for quick membership checks. */
export const bookmarkedCoordinates = derived(
	bookmarkListEntries,
	($entries) => new Set($entries.map((e) => e.tag[1]))
);

export async function loadBookmarks(): Promise<void> {
	const signer = get(auth);
	if (!signer) return;
	const entries = await loadList(signer, get(relays), { kind: BOOKMARKS_KIND });
	bookmarkListEntries.set(entries);
}

export async function addBookmark(coordinate: string, opts: { private?: boolean } = {}): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const isPrivate = opts.private ?? false;
	bookmarkListEntries.update((entries) => {
		if (entries.some((e) => e.tag[1] === coordinate)) return entries;
		return [...entries, { tag: ['a', coordinate], private: isPrivate }];
	});

	await saveList(signer, get(relays), { kind: BOOKMARKS_KIND }, get(bookmarkListEntries));
}

export async function removeBookmark(coordinate: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	bookmarkListEntries.update((entries) => entries.filter((e) => e.tag[1] !== coordinate));
	await saveList(signer, get(relays), { kind: BOOKMARKS_KIND }, get(bookmarkListEntries));
}

export async function setBookmarkEntryPrivacy(coordinate: string, isPrivate: boolean): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	bookmarkListEntries.update((entries) =>
		entries.map((e) => (e.tag[1] === coordinate ? { ...e, private: isPrivate } : e))
	);
	await saveList(signer, get(relays), { kind: BOOKMARKS_KIND }, get(bookmarkListEntries));
}
```

- [ ] **Step 2: Create `pins.ts`**

Create `src/lib/stores/pins.ts` (structurally identical, kind `10001`):

```ts
import { writable, derived, get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { loadList, saveList, type ListEntry } from '$lib/nostr/lists';

const PINS_KIND = 10001;

const pinnedListEntries = writable<ListEntry[]>([]);

/** Pin entries (article coordinates) with their privacy flag, for list-management UI. */
export const pinEntries = derived(pinnedListEntries, ($e) => $e);

/** Pinned article coordinates (public + private) as a Set, for quick membership checks. */
export const pinnedCoordinates = derived(
	pinnedListEntries,
	($entries) => new Set($entries.map((e) => e.tag[1]))
);

export async function loadPins(): Promise<void> {
	const signer = get(auth);
	if (!signer) return;
	const entries = await loadList(signer, get(relays), { kind: PINS_KIND });
	pinnedListEntries.set(entries);
}

export async function addPin(coordinate: string, opts: { private?: boolean } = {}): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const isPrivate = opts.private ?? false;
	pinnedListEntries.update((entries) => {
		if (entries.some((e) => e.tag[1] === coordinate)) return entries;
		return [...entries, { tag: ['a', coordinate], private: isPrivate }];
	});

	await saveList(signer, get(relays), { kind: PINS_KIND }, get(pinnedListEntries));
}

export async function removePin(coordinate: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	pinnedListEntries.update((entries) => entries.filter((e) => e.tag[1] !== coordinate));
	await saveList(signer, get(relays), { kind: PINS_KIND }, get(pinnedListEntries));
}

export async function setPinEntryPrivacy(coordinate: string, isPrivate: boolean): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	pinnedListEntries.update((entries) =>
		entries.map((e) => (e.tag[1] === coordinate ? { ...e, private: isPrivate } : e))
	);
	await saveList(signer, get(relays), { kind: PINS_KIND }, get(pinnedListEntries));
}
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/bookmarks.ts src/lib/stores/pins.ts
git commit -m "feat: add bookmark (kind 10003) and pin (kind 10001) list stores"
```

---

### Task 9: Categorized people lists store (full CRUD)

**Files:**
- Create: `src/lib/stores/categorizedLists.ts`

**Interfaces:**
- Consumes: `saveList`, `tagsToEntries`, `ListEntry`, `ListSpec` (Task 6), `decryptPrivateTags` (Task 5), `auth`, `relays`.
- Produces:
  - `type CategorizedList = { name: string; entries: ListEntry[] }`
  - `categorizedLists: Readable<CategorizedList[]>`
  - `loadCategorizedLists(): Promise<void>`
  - `createCategorizedList(name: string): Promise<void>`
  - `renameCategorizedList(oldName: string, newName: string): Promise<void>`
  - `deleteCategorizedList(name: string): Promise<void>`
  - `addPersonToList(name: string, pubkey: string, opts?: { private?: boolean }): Promise<void>`
  - `removePersonFromList(name: string, pubkey: string): Promise<void>`
  - `setListEntryPrivacy(name: string, pubkey: string, isPrivate: boolean): Promise<void>`

- [ ] **Step 1: Implement `categorizedLists.ts`**

Create `src/lib/stores/categorizedLists.ts`:

```ts
import { writable, derived, get } from 'svelte/store';
import { SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { auth } from '$lib/stores/auth';
import { relays } from '$lib/stores/relays';
import { saveList, tagsToEntries, type ListEntry } from '$lib/nostr/lists';
import { decryptPrivateTags } from '$lib/nostr/listCrypto';

const CATEGORIZED_KIND = 30000;

export type CategorizedList = { name: string; entries: ListEntry[] };

const listsStore = writable<CategorizedList[]>([]);

export const categorizedLists = derived(listsStore, ($l) => $l);

export async function loadCategorizedLists(): Promise<void> {
	const signer = get(auth);
	if (!signer) return;

	const pool = new SimplePool();
	let events: NostrEvent[];
	try {
		events = await pool.querySync(get(relays), {
			kinds: [CATEGORIZED_KIND],
			authors: [signer.pubkey]
		});
	} finally {
		pool.destroy();
	}

	// Keep only the latest event per "d" tag (parameterized-replaceable semantics)
	const latestByName = new Map<string, NostrEvent>();
	for (const event of events) {
		const name = event.tags.find(([k]) => k === 'd')?.[1];
		if (!name) continue;
		const existing = latestByName.get(name);
		if (!existing || event.created_at > existing.created_at) latestByName.set(name, event);
	}

	const result: CategorizedList[] = [];
	for (const [name, event] of latestByName) {
		const publicTags = event.tags.filter(([k]) => k !== 'd');
		const privateTags = await decryptPrivateTags(signer, event.content);
		result.push({ name, entries: tagsToEntries(publicTags, privateTags) });
	}
	listsStore.set(result);
}

export async function createCategorizedList(name: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');
	if (get(listsStore).some((l) => l.name === name)) throw new Error('A list with that name already exists');

	listsStore.update((lists) => [...lists, { name, entries: [] }]);
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, []);
}

export async function renameCategorizedList(oldName: string, newName: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const list = get(listsStore).find((l) => l.name === oldName);
	if (!list) throw new Error(`List "${oldName}" not found`);

	// Publish under the new coordinate, then delete the old one.
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: newName }, list.entries);
	await deleteCategorizedList(oldName);

	listsStore.update((lists) => lists.map((l) => (l.name === oldName ? { ...l, name: newName } : l)));
}

export async function deleteCategorizedList(name: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	// Publish an empty replacement (so the list reads as empty going forward)
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, []);

	// Also send a NIP-09 deletion request for the coordinate
	const coordinate = `${CATEGORIZED_KIND}:${signer.pubkey}:${name}`;
	const deletionEvent: NostrEvent = {
		kind: 5,
		created_at: Math.floor(Date.now() / 1000),
		tags: [['a', coordinate]],
		content: 'list deleted',
		pubkey: signer.pubkey
	} as NostrEvent;
	const signed = await signer.sign(deletionEvent);
	const pool = new SimplePool();
	try {
		await Promise.allSettled(pool.publish(get(relays), signed));
	} finally {
		pool.destroy();
	}

	listsStore.update((lists) => lists.filter((l) => l.name !== name));
}

export async function addPersonToList(
	name: string,
	pubkey: string,
	opts: { private?: boolean } = {}
): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	const isPrivate = opts.private ?? false;
	listsStore.update((lists) =>
		lists.map((l) => {
			if (l.name !== name) return l;
			if (l.entries.some((e) => e.tag[1] === pubkey)) return l;
			return { ...l, entries: [...l.entries, { tag: ['p', pubkey], private: isPrivate }] };
		})
	);

	const list = get(listsStore).find((l) => l.name === name);
	if (!list) throw new Error(`List "${name}" not found`);
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, list.entries);
}

export async function removePersonFromList(name: string, pubkey: string): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	listsStore.update((lists) =>
		lists.map((l) => (l.name === name ? { ...l, entries: l.entries.filter((e) => e.tag[1] !== pubkey) } : l))
	);

	const list = get(listsStore).find((l) => l.name === name);
	if (!list) throw new Error(`List "${name}" not found`);
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, list.entries);
}

export async function setListEntryPrivacy(name: string, pubkey: string, isPrivate: boolean): Promise<void> {
	const signer = get(auth);
	if (!signer) throw new Error('Not authenticated');

	listsStore.update((lists) =>
		lists.map((l) =>
			l.name === name
				? { ...l, entries: l.entries.map((e) => (e.tag[1] === pubkey ? { ...e, private: isPrivate } : e)) }
				: l
		)
	);

	const list = get(listsStore).find((l) => l.name === name);
	if (!list) throw new Error(`List "${name}" not found`);
	await saveList(signer, get(relays), { kind: CATEGORIZED_KIND, dTag: name }, list.entries);
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/categorizedLists.ts
git commit -m "feat: add categorized people list (kind 30000) store with full CRUD"
```

---

### Task 10: `/lists` page — Mute, Bookmarks, Pins sections

**Files:**
- Create: `src/routes/lists/+page.svelte`
- Modify: `src/routes/settings/+page.svelte` (nav link)

**Interfaces:**
- Consumes: `blockedEntries`, `unblockUser`, `setBlockedEntryPrivacy`, `loadSocialLists` (Task 7); `bookmarkEntries`, `removeBookmark`, `setBookmarkEntryPrivacy`, `loadBookmarks` (Task 8); `pinEntries`, `removePin`, `setPinEntryPrivacy`, `loadPins` (Task 8); `auth` (`Signer`); `profileCache`, `requestProfiles`, `displayName` (existing `$lib/stores/profiles`); `fetchArticleByIdentifier` (existing `$lib/nostr/fetch`).
- Produces: route `/lists`, and a link to it from Settings.

- [ ] **Step 1: Build the page for Mute/Bookmarks/Pins**

Create `src/routes/lists/+page.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores/auth';
	import { relays } from '$lib/stores/relays';
	import { profileCache, requestProfiles, displayName } from '$lib/stores/profiles';
	import { fetchArticleByIdentifier } from '$lib/nostr/fetch';
	import {
		blockedEntries,
		unblockUser,
		setBlockedEntryPrivacy,
		loadSocialLists
	} from '$lib/stores/social';
	import {
		bookmarkEntries,
		removeBookmark,
		setBookmarkEntryPrivacy,
		loadBookmarks
	} from '$lib/stores/bookmarks';
	import { pinEntries, removePin, setPinEntryPrivacy, loadPins } from '$lib/stores/pins';

	let signer = $derived($auth);
	let hasCrypto = $derived(!!(signer?.nip04 || signer?.nip44));

	/** coordinate ("30023:pubkey:d") -> resolved article title, filled in as fetches complete */
	let articleTitles = $state<Record<string, string>>({});

	function parseCoordinate(coordinate: string): { pubkey: string; identifier: string } | null {
		const [, pubkey, identifier] = coordinate.split(':');
		if (!pubkey || identifier === undefined) return null;
		return { pubkey, identifier };
	}

	async function resolveArticleTitles(coordinates: string[]) {
		for (const coordinate of coordinates) {
			if (articleTitles[coordinate]) continue;
			const parsed = parseCoordinate(coordinate);
			if (!parsed) continue;
			const article = await fetchArticleByIdentifier(parsed.pubkey, parsed.identifier, $relays);
			if (article) {
				const title = article.tags.find(([k]) => k === 'title')?.[1] || parsed.identifier;
				articleTitles = { ...articleTitles, [coordinate]: title };
			}
		}
	}

	onMount(() => {
		loadSocialLists();
		loadBookmarks();
		loadPins();
	});

	$effect(() => {
		const pubkeys = $blockedEntries.map((e) => e.tag[1]);
		if (pubkeys.length > 0) requestProfiles(pubkeys);
	});

	$effect(() => {
		const coordinates = [...$bookmarkEntries, ...$pinEntries].map((e) => e.tag[1]);
		if (coordinates.length > 0) resolveArticleTitles(coordinates);
	});
</script>

<div class="lists-page">
	<h1>Lists</h1>

	{#if !hasCrypto}
		<p class="crypto-warning">
			Your signer doesn't support encrypted list entries, so private toggles are disabled below.
		</p>
	{/if}

	<section>
		<h2>Muted</h2>
		{#if $blockedEntries.length === 0}
			<p class="empty">No muted accounts.</p>
		{/if}
		{#each $blockedEntries as entry (entry.tag[1])}
			<div class="row">
				<span class="subject">{displayName(entry.tag[1], $profileCache)}</span>
				<label class="privacy-toggle">
					<input
						type="checkbox"
						checked={entry.private}
						disabled={!hasCrypto}
						onchange={(e) => setBlockedEntryPrivacy(entry.tag[1], (e.target as HTMLInputElement).checked)}
					/>
					Private
				</label>
				<button onclick={() => unblockUser(entry.tag[1])}>Remove</button>
			</div>
		{/each}
	</section>

	<section>
		<h2>Bookmarks</h2>
		{#if $bookmarkEntries.length === 0}
			<p class="empty">No bookmarked articles.</p>
		{/if}
		{#each $bookmarkEntries as entry (entry.tag[1])}
			<div class="row">
				<span class="subject">{articleTitles[entry.tag[1]] ?? entry.tag[1]}</span>
				<label class="privacy-toggle">
					<input
						type="checkbox"
						checked={entry.private}
						disabled={!hasCrypto}
						onchange={(e) => setBookmarkEntryPrivacy(entry.tag[1], (e.target as HTMLInputElement).checked)}
					/>
					Private
				</label>
				<button onclick={() => removeBookmark(entry.tag[1])}>Remove</button>
			</div>
		{/each}
	</section>

	<section>
		<h2>Pinned</h2>
		{#if $pinEntries.length === 0}
			<p class="empty">No pinned articles.</p>
		{/if}
		{#each $pinEntries as entry (entry.tag[1])}
			<div class="row">
				<span class="subject">{articleTitles[entry.tag[1]] ?? entry.tag[1]}</span>
				<label class="privacy-toggle">
					<input
						type="checkbox"
						checked={entry.private}
						disabled={!hasCrypto}
						onchange={(e) => setPinEntryPrivacy(entry.tag[1], (e.target as HTMLInputElement).checked)}
					/>
					Private
				</label>
				<button onclick={() => removePin(entry.tag[1])}>Remove</button>
			</div>
		{/each}
	</section>
</div>

<style>
	.lists-page {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--space-lg);
	}
	.crypto-warning {
		font-size: 0.875rem;
		color: var(--c-text-secondary);
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		padding: var(--space-sm) var(--space-md);
		margin-bottom: var(--space-md);
	}
	section {
		margin-bottom: var(--space-lg);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-xs) 0;
		border-bottom: 1px solid var(--c-border);
	}
	.subject {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.privacy-toggle {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
	}
	.empty {
		font-size: 0.875rem;
		color: var(--c-text-secondary);
	}
</style>
```

- [ ] **Step 2: Add a nav link from Settings**

Modify `src/routes/settings/+page.svelte` — find the top of the markup (after the opening of the settings container) and add a link. First check the current markup structure:

Run: `grep -n "<h1\|</script>" src/routes/settings/+page.svelte`

Add immediately after the page's `<h1>` heading (matching whatever heading text is already there):

```svelte
	<a href="/lists" class="lists-link">Manage lists (mute, bookmarks, pins, categorized)</a>
```

Add a matching style block entry near the existing `<style>` section:

```css
	.lists-link {
		display: inline-block;
		margin-bottom: var(--space-md);
		color: var(--c-accent);
		text-decoration: none;
	}
	.lists-link:hover {
		text-decoration: underline;
	}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, log in, navigate to `/lists`. Confirm the three sections render (empty states if no data yet), and that muting/unmuting a user from an `ArticleCard` elsewhere in the app is reflected here after reload.

- [ ] **Step 4: Commit**

```bash
git add src/routes/lists/+page.svelte src/routes/settings/+page.svelte
git commit -m "feat: add /lists page for mute, bookmarks, and pins"
```

---

### Task 11: `/lists` page — Categorized Lists section (CRUD)

**Files:**
- Modify: `src/routes/lists/+page.svelte`

**Interfaces:**
- Consumes: `categorizedLists`, `loadCategorizedLists`, `createCategorizedList`, `renameCategorizedList`, `deleteCategorizedList`, `addPersonToList`, `removePersonFromList`, `setListEntryPrivacy` (Task 9).

- [ ] **Step 1: Add the Categorized Lists section**

Modify `src/routes/lists/+page.svelte` — add to the `<script>` block's imports:

```ts
	import {
		categorizedLists,
		loadCategorizedLists,
		createCategorizedList,
		renameCategorizedList,
		deleteCategorizedList,
		addPersonToList,
		removePersonFromList,
		setListEntryPrivacy
	} from '$lib/stores/categorizedLists';
```

Add to the `onMount` call:

```ts
	onMount(() => {
		loadSocialLists();
		loadBookmarks();
		loadPins();
		loadCategorizedLists();
	});
```

Add local state for the "new list" and "add person" inputs, near the other `let` declarations:

```ts
	let newListName = $state('');
	let addPersonInputs = $state<Record<string, string>>({});

	async function handleCreateList() {
		const name = newListName.trim();
		if (!name) return;
		await createCategorizedList(name);
		newListName = '';
	}

	async function handleRename(oldName: string) {
		const newName = prompt('Rename list to:', oldName);
		if (!newName || newName === oldName) return;
		await renameCategorizedList(oldName, newName.trim());
	}

	async function handleAddPerson(listName: string) {
		const pubkey = (addPersonInputs[listName] ?? '').trim();
		if (!pubkey) return;
		await addPersonToList(listName, pubkey, { private: true });
		addPersonInputs[listName] = '';
	}
```

Add a new `<section>` to the markup, after the Pinned section:

```svelte
	<section>
		<h2>Categorized Lists</h2>
		<div class="row">
			<input
				type="text"
				placeholder="New list name (e.g. Friends)"
				bind:value={newListName}
				onkeydown={(e) => e.key === 'Enter' && handleCreateList()}
			/>
			<button onclick={handleCreateList}>Create list</button>
		</div>

		{#each $categorizedLists as list (list.name)}
			<div class="categorized-list">
				<div class="row">
					<strong class="subject">{list.name}</strong>
					<button onclick={() => handleRename(list.name)}>Rename</button>
					<button onclick={() => deleteCategorizedList(list.name)}>Delete</button>
				</div>

				{#each list.entries as entry (entry.tag[1])}
					<div class="row">
						<span class="subject">{displayName(entry.tag[1], $profileCache)}</span>
						<label class="privacy-toggle">
							<input
								type="checkbox"
								checked={entry.private}
								disabled={!hasCrypto}
								onchange={(e) =>
									setListEntryPrivacy(list.name, entry.tag[1], (e.target as HTMLInputElement).checked)}
							/>
							Private
						</label>
						<button onclick={() => removePersonFromList(list.name, entry.tag[1])}>Remove</button>
					</div>
				{/each}

				<div class="row">
					<input
						type="text"
						placeholder="Pubkey (hex) to add"
						bind:value={addPersonInputs[list.name]}
						onkeydown={(e) => e.key === 'Enter' && handleAddPerson(list.name)}
					/>
					<button onclick={() => handleAddPerson(list.name)}>Add</button>
				</div>
			</div>
		{/each}
	</section>
```

Add supporting styles to the `<style>` block:

```css
	.categorized-list {
		margin-bottom: var(--space-md);
		padding: var(--space-sm);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
	}
	input[type='text'] {
		flex: 1;
		padding: var(--space-xs) var(--space-sm);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		background: var(--c-bg);
		color: inherit;
	}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`, navigate to `/lists`, create a new categorized list, add a pubkey to it (as private, since that's the only add path here), toggle it public, rename the list, then delete it. Confirm each action round-trips after a page reload (i.e. actually persisted to relays).

- [ ] **Step 3: Commit**

```bash
git add src/routes/lists/+page.svelte
git commit -m "feat: add categorized-list CRUD to /lists page"
```

---

### Task 12: Quick-action buttons on ArticleCard (bookmark, pin)

**Files:**
- Modify: `src/lib/components/ArticleCard.svelte`

**Interfaces:**
- Consumes: `bookmarkedCoordinates`, `addBookmark`, `removeBookmark`, `loadBookmarks` (Task 8); `pinnedCoordinates`, `addPin`, `removePin`, `loadPins` (Task 8); `blockUser` (Task 7, signature already accepts `opts: { private?: boolean }`).
- Produces: two new buttons alongside the existing Follow/Block buttons; all three quick actions (mute, bookmark, pin) default new entries to `private: true` per spec §4.

- [ ] **Step 1: Add imports and derived coordinate**

Modify `src/lib/components/ArticleCard.svelte` — extend the existing import block (currently lines 6-16):

```ts
	import {
		follows,
		blocks,
		followUser,
		unfollowUser,
		blockUser,
		unblockUser,
		loadSocialLists
	} from '$lib/stores/social';
	import {
		bookmarkedCoordinates,
		addBookmark,
		removeBookmark,
		loadBookmarks
	} from '$lib/stores/bookmarks';
	import { pinnedCoordinates, addPin, removePin, loadPins } from '$lib/stores/pins';
```

- [ ] **Step 2: Add the article coordinate, load calls, and handlers**

Modify the `$effect` that calls `loadSocialLists()` (currently lines 33-36) to also load bookmarks/pins:

```ts
	// Load social lists once when we have a logged-in user
	$effect(() => {
		if ($myPubkey) {
			loadSocialLists();
			loadBookmarks();
			loadPins();
		}
	});
```

Add a coordinate helper and derived/state values near the existing ones (after `getIdentifier`, currently line 60):

```ts
	function getCoordinate(): string {
		return `30023:${event.pubkey}:${getIdentifier()}`;
	}
```

Add derived/state values near `isFollowing`/`isBlocked` (currently lines 78-82):

```ts
	let isFollowing = $derived($follows.has(event.pubkey));
	let isBlocked = $derived($blocks.has(event.pubkey));
	let isBookmarked = $derived($bookmarkedCoordinates.has(getCoordinate()));
	let isPinned = $derived($pinnedCoordinates.has(getCoordinate()));

	let followBusy = $state(false);
	let blockBusy = $state(false);
	let bookmarkBusy = $state(false);
	let pinBusy = $state(false);
```

Modify `handleBlock` itself (currently lines 97-108) so the mute quick action also defaults new entries to private, matching bookmark/pin:

```ts
	async function handleBlock(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (blockBusy) return;
		blockBusy = true;
		try {
			if (isBlocked) await unblockUser(event.pubkey);
			else await blockUser(event.pubkey, { private: true });
		} finally {
			blockBusy = false;
		}
	}
```

Add handlers near `handleBlock`:

```ts
	async function handleBookmark(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (bookmarkBusy) return;
		bookmarkBusy = true;
		try {
			const coordinate = getCoordinate();
			if (isBookmarked) await removeBookmark(coordinate);
			else await addBookmark(coordinate, { private: true });
		} finally {
			bookmarkBusy = false;
		}
	}

	async function handlePin(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (pinBusy) return;
		pinBusy = true;
		try {
			const coordinate = getCoordinate();
			if (isPinned) await removePin(coordinate);
			else await addPin(coordinate, { private: true });
		} finally {
			pinBusy = false;
		}
	}
```

- [ ] **Step 3: Add the buttons to the markup**

Modify the markup — add two buttons after the existing Block button (currently ending at line 160, right before the closing `{/if}` of `showSocialActions`):

```svelte
			<!-- Bookmark button -->
			<button
				class="social-btn bookmark-btn"
				class:active={isBookmarked}
				onclick={handleBookmark}
				disabled={bookmarkBusy}
				title={isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
				aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
			>
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path d="M4 1.5h8a1 1 0 0 1 1 1V15l-5-3.5L3 15V2.5a1 1 0 0 1 1-1z" />
				</svg>
			</button>

			<!-- Pin button -->
			<button
				class="social-btn pin-btn"
				class:active={isPinned}
				onclick={handlePin}
				disabled={pinBusy}
				title={isPinned ? 'Unpin article' : 'Pin article'}
				aria-label={isPinned ? 'Unpin article' : 'Pin article'}
			>
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path d="M8 1l1.5 4.5L14 7l-4 3 .5 5-2.5-3-2.5 3 .5-5-4-3 4.5-1.5z" />
				</svg>
			</button>
```

- [ ] **Step 4: Add matching styles**

Modify the `<style>` block — add after the existing `.block-btn` rules (currently ending at line 279):

```css
	/* Bookmark */
	.bookmark-btn:hover:not(:disabled) {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 10%, transparent);
	}
	.bookmark-btn.active {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 15%, transparent);
	}

	/* Pin */
	.pin-btn:hover:not(:disabled) {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 10%, transparent);
	}
	.pin-btn.active {
		color: var(--c-accent);
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 15%, transparent);
	}
```

- [ ] **Step 5: Type-check and manual verification**

Run: `npm run check`
Expected: no new errors.

Run: `npm run dev`, log in, open the article feed, click Bookmark and Pin on an article, confirm the buttons toggle active state, then check `/lists` shows the new entries marked private.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/ArticleCard.svelte
git commit -m "feat: add bookmark/pin quick actions to ArticleCard, private by default"
```

---

## Manual Cross-Client Interop Check (post-implementation)

Not a coded task — a verification pass per the spec's Testing section:

1. Using this app, mute a test account with the private toggle on.
2. Open the same account in another NIP-51-aware client (e.g. Amethyst or Damus) and confirm the private mute entry decrypts and shows correctly.
3. In that other client, add a different private mute entry.
4. Reload `/lists` in this app and confirm that entry decrypts correctly here too (validates the NIP-44-then-NIP-04 fallback against whatever cipher the other client used).
