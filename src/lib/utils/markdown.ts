import { marked } from 'marked';
import { nip19 } from 'nostr-tools';

function normalizeNostrHref(href: string): string {
	if (!href.startsWith('nostr:')) return href;

	const bech32 = href.slice('nostr:'.length);
	if (!bech32) return href;

	return `https://njump.me/${bech32}`;
}

function decodeNostrCode(code: string): string | null {
	try {
		const decoded = nip19.decode(code);
		if (decoded.type === 'npub') return decoded.data;
		if (decoded.type === 'nprofile') return decoded.data.pubkey;
		if (decoded.type === 'naddr') return decoded.data.pubkey;
		if (decoded.type === 'nevent' && decoded.data.author) return decoded.data.author;
		return null;
	} catch {
		return null;
	}
}

const nostrLinkExtension = {
	name: 'nostrLink',
	level: 'inline' as const,
	start(src: string) {
		return src.indexOf('nostr:');
	},
	tokenizer(src: string) {
		const match = /^nostr:([a-z0-9]+)/i.exec(src);
		if (!match) return;

		const code = match[1];
		if (!decodeNostrCode(code)) return;

		return {
			type: 'nostrLink',
			raw: match[0],
			href: `nostr:${code}`,
			text: match[0]
		};
	},
	renderer(token: { href: string; text: string }) {
		return `<a href="${normalizeNostrHref(token.href)}">${token.text}</a>`;
	}
};

const renderer = new marked.Renderer();

renderer.link = function (token) {
	const fallbackRenderer = new marked.Renderer();
	fallbackRenderer.parser = this.parser;

	return fallbackRenderer.link({
		...token,
		href: normalizeNostrHref(token.href)
	});
};

marked.use({
	gfm: true,
	breaks: false,
	extensions: [nostrLinkExtension],
	renderer
});

export function renderMarkdown(content: string): string {
	return marked.parse(content, { async: false }) as string;
}

export function extractNostrPubkeys(content: string): string[] {
	const pubkeys = new Set<string>();
	const matches = content.matchAll(/nostr:([a-z0-9]+)/gi);

	for (const match of matches) {
		const code = match[1];
		const pubkey = decodeNostrCode(code);
		if (pubkey) pubkeys.add(pubkey);
	}

	return [...pubkeys];
}
