import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './utils/env';

export async function storeKeychain(key: string): Promise<void> {
	if (!isTauri()) return;
	await invoke('store_keychain', { key });
}

export async function getKeychain(): Promise<string | null> {
	if (!isTauri()) return null;
	return invoke<string | null>('get_keychain');
}

export async function clearKeychain(): Promise<void> {
	if (!isTauri()) return;
	await invoke('clear_keychain');
}

export async function saveMarkdownFile(title: string, content: string): Promise<string | null> {
	if (!isTauri()) return null;
	return invoke<string | null>('save_markdown', { title, content });
}

export async function notifyNewArticle(author: string, title: string): Promise<void> {
	if (!isTauri()) return;
	await invoke('notify_new_article', { author, title });
}
