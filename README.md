<picture>
  <source media="(prefers-color-scheme: dark)" srcset="static/brand/pen-logo-flat.png">
  <source media="(prefers-color-scheme: light)" srcset="static/brand/pen-logo-flat.png">
  <img alt="write_nostr" src="static/brand/pen-logo-flat.png" width="480">
</picture>

# write_nostr

**write_nostr** is a browser-based long-form writing app for the Nostr protocol. It provides a distraction-free Markdown editor for composing, publishing, and managing NIP-23 long-form content (`kind:30023`) directly to Nostr relays, along with feeds for discovering articles from the network.

Built with Svelte 5 and SvelteKit, write_nostr runs as a fully static single-page app — no backend required. Authentication works via NIP-07 browser extensions, nsec keys, or passkeys (WebAuthn/PRF). Articles are rendered with live preview, support metadata (title, summary, featured image, tags), and auto-save to localStorage drafts. The app is installable as a PWA with offline support.

Whether you're a writer looking for a censorship-resistant publishing platform or a Nostr user who wants to read and engage with long-form content on the decentralized web, write_nostr offers a clean, focused experience.

## Features

- **Write & Publish** — Full-featured Markdown editor with live preview, formatting toolbar, metadata (title, summary, featured image, tags), and direct publishing to Nostr relays.
- **Browse Articles** — Three feed modes: **All** (global firehose), **My Circle** (articles from people you follow), and **Top Articles** (sorted by interaction score). Tag filtering, pagination, and manual refresh.
- **Drafts** — Auto-saving drafts to localStorage with a dedicated drafts manager.
- **Authentication** — Sign in via NIP-07 browser extension, paste an nsec key, or use a passkey (WebAuthn/PRF).
- **Social** — Follow/unfollow and block/unblock authors directly from the feed.
- **Profiles** — Kind:0 profile metadata fetched from relays, cached for performance.
- **Translation** — On-device article translation via Chrome's Built-in AI Translation API.
- **PWA** — Installable as a progressive web app with offline support.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Svelte 5](https://svelte.dev/) + [SvelteKit 2](https://kit.svelte.dev/) (runes mode) |
| Build | [Vite 8](https://vitejs.dev/) + [TypeScript 6](https://www.typescriptlang.org/) |
| Nostr | [nostr-tools](https://github.com/nbd-wtf/nostr-tools) — SimplePool, event signing, NIP-19 encoding/decoding |
| Passkeys | [nostr-passkey](https://github.com/nostr-passkey/nostr-passkey) — WebAuthn/PRF-based key management |
| Markdown | [marked](https://marked.js.org/) — rendering |
| Caching | [idb](https://github.com/jakearchibald/idb) — IndexedDB cache layer |
| Adapter | [@sveltejs/adapter-static](https://kit.svelte.dev/docs/adapter-static) — static SPA output |

## Nostr Protocols (NIPs)

- **NIP-01** — Basic protocol & relay communication
- **NIP-02** — Contact lists (kind:3)
- **NIP-07** — Browser extension signer
- **NIP-19** — bech32-encoded entities (`nsec`, `npub`, `naddr`, `nprofile`, `nevent`)
- **NIP-23** — Long-form content (kind:30023)
- **NIP-51** — Lists (kind:10000 mute/block lists)
- **NIP-65** — Relay list metadata (kind:10002)

## Getting Started

```bash
npm install
npm run dev        # Development server with hot reload
```

Open the URL printed by Vite (usually `http://localhost:5173`).

## Build & Preview

```bash
npm run build      # Production build to ./build
npm run preview    # Preview the production build locally
```

## Deploy

```bash
npm run deploy -- --host user@host --domain example.com
```

The deploy script:
1. Builds the project
2. Syncs to a remote server via rsync over SSH
3. Installs a systemd service running the built files via the included Python SPA HTTP server
4. Optionally configures Caddy or nginx as a reverse proxy with TLS

### Prerequisites

- **Local**: `npm`, `rsync`
- **Remote**: `python3`, `systemctl`, `ss`, `curl`, `rsync`, `sudo`

### Configuration

Environment variables: `WRITE_NOSTR_SSH_TARGET`, `WRITE_NOSTR_DOMAIN`, `WRITE_NOSTR_PORT`, etc.

## Type Checking

```bash
npm run check
```

## Project Structure

```
src/
├── app.html                 # HTML shell
├── app.css                  # Global styles (light/dark mode)
├── lib/
│   ├── components/          # Svelte components (Editor, ArticleCard, etc.)
│   ├── stores/              # Svelte stores (auth, relays, drafts, social, profiles)
│   ├── nostr/               # Nostr logic (fetch, publish, resolve, profiles)
│   └── utils/               # Utilities (markdown, NIP-19, translation)
├── routes/
│   ├── +page.svelte         # Main feed page
│   ├── +layout.svelte       # Root layout
│   ├── new/                 # Editor (/new)
│   ├── drafts/              # Drafts manager (/drafts)
│   ├── settings/            # Settings (/settings)
│   └── article/[naddr]/     # Article view (/article/[naddr])
static/
├── brand/                   # Logo assets
├── pwa/                     # PWA icons
├── manifest.webmanifest     # PWA manifest
└── sw.js                    # Service worker
```

## Default Relays

- `wss://relay.damus.io`
- `wss://relay.nostr.band`
- `wss://nos.lol`
- `wss://relay.primal.net`

Relays can be managed in Settings after login.

## License

[MIT](LICENSE)
