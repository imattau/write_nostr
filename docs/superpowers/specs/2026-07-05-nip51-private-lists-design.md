# NIP-51 List Support (Public + Private) — Design

## Problem

The app currently handles only two Nostr list-like events: kind `3` (contact/follow list, pre-NIP-51) and kind `10000` (mute/block list). For the mute list, only public `p` tags are read/written — [social.ts](../../../src/lib/stores/social.ts) always publishes `content: ''`, so any NIP-51 *private* entries (a NIP-04/NIP-44-encrypted JSON tag array stored in `content`) are silently dropped on read and destroyed on write.

Separately, the app has no support at all for three other common NIP-51 list kinds: bookmarks (`10003`), pinned articles (`10001`), and categorized/named people lists (`30000`).

This spec covers adding full public+private support for all four list kinds, sharing one encryption/list infrastructure.

## Goals

- Signers gain NIP-04/NIP-44 encrypt/decrypt capability where the underlying key material allows it.
- A generic, reusable list module handles fetch/decrypt/merge and split/encrypt/publish for any NIP-51-style list (single replaceable or parameterized-replaceable), so each list kind is a thin wrapper.
- Mute (`10000`), bookmarks (`10003`), pins (`10001`), and categorized people lists (`30000`) all support public and private entries.
- A single `/lists` page lets users view and manage all of the above, including full create/rename/delete for categorized lists.
- Quick inline actions (mute/bookmark buttons on `ArticleCard`) remain for convenience, defaulting new entries to **private**.

## Non-goals

- No changes to kind `3` (follow list) — it predates NIP-51 and isn't in scope for private entries.
- No attempt to migrate or fix historical mute-list events beyond correctly reading whatever public/private content they contain.
- No offline/local-only bookmark cache beyond what already exists for article rendering.

## Architecture

### 1. Signer encryption capability

Extend the `Signer` type in [auth.ts](../../../src/lib/stores/auth.ts):

```ts
export type Signer = {
  type: 'extension' | 'nsec' | 'passkey' | 'keychain';
  pubkey: string;
  sign: (event: NostrEvent) => Promise<NostrEvent>;
  nip04?: { encrypt(pubkey: string, plaintext: string): Promise<string>; decrypt(pubkey: string, ciphertext: string): Promise<string> };
  nip44?: { encrypt(pubkey: string, plaintext: string): Promise<string>; decrypt(pubkey: string, ciphertext: string): Promise<string> };
};
```

Per-backend implementation:
- **nsec / keychain**: implement directly using `nostr-tools`' `nip04`/`nip44` modules against the in-closure secret key (mirrors the existing pattern in [nwc.ts](../../../src/lib/stores/nwc.ts)). Both `nip04` and `nip44` are always present for these signer types.
- **passkey**: `nostr-passkey`'s `buildPasskeySignerShim` already returns `nip04`/`nip44` encrypt/decrypt methods (confirmed in `node_modules/nostr-passkey/dist/index.d.ts`) — pass them straight through onto the `Signer`.
- **extension (NIP-07)**: feature-detect `window.nostr.nip04` / `window.nostr.nip44` at signer-construction time; only attach the methods that exist. If neither exists, `signer.nip04`/`nip44` stay `undefined`.

Any UI that offers a "private" toggle must check for `signer.nip44 || signer.nip04` and disable/hide the toggle (with an explanatory tooltip) when neither is available.

### 2. Generic NIP-51 list module

New file `src/lib/nostr/lists.ts`, replacing the list-specific logic currently embedded in `social.ts`.

```ts
type ListEntry = { tag: string[]; private: boolean };

interface ListSpec {
  kind: number;          // 10000, 10003, 10001, or 30000
  dTag?: string;         // required for kind 30000 (parameterized replaceable)
}
```

- `loadList(spec: ListSpec): Promise<ListEntry[]>`
  1. Query the relay set for the matching event (author = self; for kind 30000, filter by `d` tag).
  2. Public entries = event's public tags (excluding the `d` tag itself for kind 30000).
  3. If `content` is non-empty and the signer has crypto capability: try NIP-44 decrypt, then fall back to NIP-04 decrypt. Parse the result as a JSON tag array. Each becomes a `ListEntry` with `private: true`.
  4. If decryption fails or the signer has no crypto capability, the private portion is treated as empty (see Error Handling).
  5. Return the merged array (public entries first, then private, in original order within each group).

- `saveList(spec: ListSpec, entries: ListEntry[]): Promise<void>`
  1. Split `entries` by `.private`.
  2. Public tags go directly into the event's `tags` array (plus the `d` tag for kind 30000).
  3. Private tags are JSON-encoded and encrypted to the user's own pubkey using NIP-44 if `signer.nip44` exists, else NIP-04 if `signer.nip04` exists, else left as an empty string (private entries are effectively dropped — see Error Handling) and a warning is surfaced to the caller.
  4. Build, sign, and publish the event via the existing relay pool pattern.

Mute, bookmarks, pins, and categorized lists each become a small wrapper module (or functions) over `loadList`/`saveList`, translating domain concepts (pubkeys, article coordinates) to/from `ListEntry[]`.

### 3. Per-list-kind specifics

| List | Kind | Tag shape | Parameterized? |
|---|---|---|---|
| Mute | 10000 | `['p', pubkey]` | No |
| Bookmarks | 10003 | `['a', articleCoordinate]` (or `['e', eventId]` for non-article events) | No |
| Pins | 10001 | `['a', articleCoordinate]` | No |
| Categorized people | 30000 | `['p', pubkey]` + `['d', listName]` | Yes, one event per `d` tag |

- **Mute**: direct replacement of current `social.ts` follow/mute logic for the mute half; `followedPubkeys`/kind `3` logic is untouched.
- **Bookmarks**: new. `ArticleCard` gets a bookmark toggle button, private-by-default.
- **Pins**: new, structurally identical to bookmarks but a separate list and button ("Pin"), so users can pin any article (their own or others') as a personal highlight list, private-by-default.
- **Categorized people lists**: new, full CRUD — create (prompts for a name, used as the `d` tag), rename (changes the `d` tag, which means republishing under a new coordinate and letting the old one age out — acceptable since these are user-initiated, infrequent actions), delete (publish an event with empty tags/content, or simply stop rendering it — relays don't support deleting parameterized-replaceable events other than via NIP-09 deletion request, which should be sent too), add/remove person with a private/public toggle per person.

### 4. UI — unified Lists page

New route `/lists`, linked from Settings:
- Sections: Mute, Bookmarks, Pins, Categorized Lists.
- Each list entry row shows its subject (resolved profile name/avatar for `p` tags, article title for `a` tags), a public/private toggle, and a remove button.
- Categorized Lists section additionally has "New list" (name prompt → creates an empty kind 30000 list), and per-list rename/delete controls.
- When the active signer lacks any encrypt capability, all private toggles across the page are disabled with a tooltip: "Your signer doesn't support encrypted list entries."

Quick inline actions on `ArticleCard`:
- Existing mute button stays; new bookmark and pin buttons added alongside it.
- All three, when adding a *new* entry via the quick action, default to `private: true`. Removing an entry removes it regardless of its public/private status. Editing an entry's privacy is only available from the `/lists` page.

## Error Handling

- **Decrypt failure** (corrupt `content`, wrong key, unrecognized cipher): the private portion of that list is treated as empty for this load; a console warning is logged. The list still renders its public entries. This must not throw and block the page.
- **No encrypt capability on signer**: private toggles are disabled in the UI; if `saveList` is ever called with `private: true` entries and no crypto available (shouldn't happen if UI gates correctly, but defensively), those entries are dropped from the write and a warning is returned to the caller to surface as a toast/message.
- **Signer swapped mid-session**: each list's in-memory state is keyed to the current signer; switching accounts triggers a fresh `loadList` for all four kinds rather than reusing stale decrypted data.
- **Publish failure**: matches existing behavior in `social.ts` today — optimistic local update happens first, publish failures are not rolled back (not a regression, just carrying forward current behavior for this feature).

## Testing

- Unit tests for `lists.ts`: NIP-04 and NIP-44 encrypt/decrypt round-trip; correct splitting/merging of public vs private entries; decrypt-fallback ordering (NIP-44 then NIP-04); behavior when the signer has no crypto capability at all.
- Unit tests per wrapper (mute/bookmarks/pins/categorized) for correct tag-shape translation.
- Manual cross-client interop check: verify a mute list (with a private entry) written by this app is readable by another NIP-51-aware client (e.g. Amethyst or Damus), and that a private mute list written by such a client is correctly decrypted here — this is the highest-risk area given the NIP-04-vs-NIP-44 split in the wild.
