import { marked } from 'marked';

marked.use({
	gfm: true,
	breaks: false
});

export function renderMarkdown(content: string): string {
	let html = marked.parse(content, { async: false }) as string;
	html = html.replace(
		/\"(nostr:)(n(?:ote|ev ent|pub|profile|addr)1[qpzs0-9a-z]+)\"/g,
		(_m, _prefix, bech32) => {
			return `"https://njump.me/${bech32}"`;
		}
	);
	return html;
}
