import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_BLOSSOM_SERVERS,
	convertImageToWebp,
	loadBlossomSettings,
	saveBlossomSettings,
	uploadImage
} from './blossom';

const values = new Map<string, string>();
const storage = {
	getItem: (key: string) => values.get(key) ?? null,
	setItem: (key: string, value: string) => values.set(key, value),
	removeItem: (key: string) => values.delete(key)
};

describe('Blossom settings and uploads', () => {
	afterEach(() => {
		values.clear();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('provides built-in servers until account settings are saved', () => {
		vi.stubGlobal('localStorage', storage);
		expect(loadBlossomSettings('account').servers).toEqual(DEFAULT_BLOSSOM_SERVERS);
	});

	it('saves normalized, unique server URLs per account', () => {
		vi.stubGlobal('localStorage', storage);
		saveBlossomSettings('account', {
			servers: ['https://media.example/path/', 'https://media.example/path', 'javascript:alert(1)', 'not a URL']
		});
		expect(loadBlossomSettings('account').servers).toEqual(['https://media.example/path']);
		expect(loadBlossomSettings('another-account').servers).toEqual(DEFAULT_BLOSSOM_SERVERS);
	});

	it('converts raster images to WebP while preserving already-WebP and GIF files', async () => {
		const bitmap = { width: 2, height: 3, close: vi.fn() } as unknown as ImageBitmap;
		vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
		vi.stubGlobal('document', {
			createElement: () => ({
				width: 0,
				height: 0,
				getContext: () => ({ drawImage: vi.fn() }),
				toBlob: (callback: BlobCallback) => callback(new Blob(['webp'], { type: 'image/webp' }))
			})
		});
		const png = new File(['png'], 'photo.png', { type: 'image/png' });
		const result = await convertImageToWebp(png);
		expect(result.name).toBe('photo.webp');
		expect(result.type).toBe('image/webp');
		expect(bitmap.close).toHaveBeenCalledOnce();

		const webp = new File(['webp'], 'already.webp', { type: 'image/webp' });
		const gif = new File(['gif'], 'animation.gif', { type: 'image/gif' });
		expect(await convertImageToWebp(webp)).toBe(webp);
		expect(await convertImageToWebp(gif)).toBe(gif);
	});

	it('rejects non-image files and unauthenticated uploads with clear errors', async () => {
		const textFile = new File(['text'], 'note.txt', { type: 'text/plain' });
		await expect(uploadImage(textFile)).rejects.toThrow('Choose an image file.');
		const imageFile = new File(['image'], 'image.png', { type: 'image/png' });
		await expect(uploadImage(imageFile)).rejects.toThrow('Log in before uploading images.');
	});
});
