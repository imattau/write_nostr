/**
 * Wrapper around the Chrome Built-in AI Translation and Language Detection APIs.
 * Available in Chrome 131+ (behind flag) and Chrome 138+ natively.
 * https://developer.chrome.com/docs/ai/translator-api
 * https://developer.chrome.com/docs/ai/language-detection
 */

export type TranslationAvailability = 'available' | 'downloading' | 'unavailable';

// ─── Translator API types ────────────────────────────────────────────────────

interface ChromeTranslator {
	translate(text: string): Promise<string>;
	destroy(): void;
}

interface ChromeTranslation {
	createTranslator(opts: {
		sourceLanguage: string;
		targetLanguage: string;
	}): Promise<ChromeTranslator>;
	canTranslate(opts: {
		sourceLanguage: string;
		targetLanguage: string;
	}): Promise<TranslationAvailability>;
}

// ─── Language Detector API types ────────────────────────────────────────────

interface LanguageDetectionResult {
	detectedLanguage: string;
	confidence: number;
}

interface ChromeLanguageDetector {
	detect(text: string): Promise<LanguageDetectionResult[]>;
	destroy(): void;
}

interface ChromeLanguageDetectorFactory {
	create(): Promise<ChromeLanguageDetector>;
	capabilities(): Promise<{ available: 'readily' | 'after-download' | 'no' }>;
}

interface ChromeAI {
	languageDetector?: ChromeLanguageDetectorFactory;
}

declare global {
	interface Window {
		translation?: ChromeTranslation;
		ai?: ChromeAI;
	}
}

// ─── Feature detection ───────────────────────────────────────────────────────

export function isTranslationApiAvailable(): boolean {
	return typeof window !== 'undefined' && 'translation' in window;
}

export function isLanguageDetectorAvailable(): boolean {
	return typeof window !== 'undefined' && !!window.ai?.languageDetector;
}

// ─── Language detection ──────────────────────────────────────────────────────

/**
 * Detect the language of a text string using Chrome's on-device Language
 * Detector API. Returns a BCP-47 primary language subtag (e.g. "es", "fr")
 * or null if detection fails or API is unavailable.
 */
export async function detectLanguage(text: string): Promise<string | null> {
	if (!isLanguageDetectorAvailable()) return null;
	try {
		const capabilities = await window.ai!.languageDetector!.capabilities();
		if (capabilities.available === 'no') return null;

		const detector = await window.ai!.languageDetector!.create();
		try {
			const results = await detector.detect(text);
			// Pick the highest-confidence result above threshold
			const best = results
				.filter((r) => r.confidence > 0.4)
				.sort((a, b) => b.confidence - a.confidence)[0];
			return best?.detectedLanguage?.split('-')[0] ?? null;
		} finally {
			detector.destroy();
		}
	} catch {
		return null;
	}
}

/**
 * Determine the article's source language using a cascade:
 *  1. Chrome Language Detector API (detects actual content)
 *  2. NIP-23 `lang` tag on the Nostr event
 *  3. Fall back to 'en'
 */
export async function resolveArticleLang(
	content: string,
	tags: string[][]
): Promise<string> {
	// Try on-device detection first (most accurate)
	// Use a ~500-char sample for speed; full content is usually redundant
	const sample = content.slice(0, 500);
	const detected = await detectLanguage(sample);
	if (detected) return detected;

	// Fall back to the NIP-23 `lang` tag
	const langTag = tags.find(([k]) => k === 'lang');
	if (langTag?.[1]) return langTag[1].split('-')[0];

	return 'en';
}

// ─── Translation ─────────────────────────────────────────────────────────────

/**
 * Check whether a specific language pair can be translated.
 */
export async function canTranslate(
	sourceLanguage: string,
	targetLanguage: string
): Promise<TranslationAvailability> {
	if (!isTranslationApiAvailable()) return 'unavailable';
	try {
		return await window.translation!.canTranslate({ sourceLanguage, targetLanguage });
	} catch {
		return 'unavailable';
	}
}

/**
 * Translate an array of text strings from source to target language.
 * Returns translated strings in the same order.
 */
export async function translateTexts(
	texts: string[],
	sourceLanguage: string,
	targetLanguage: string
): Promise<string[]> {
	if (!isTranslationApiAvailable()) {
		throw new Error('Translation API not available');
	}
	const translator = await window.translation!.createTranslator({ sourceLanguage, targetLanguage });
	try {
		return await Promise.all(texts.map((t) => translator.translate(t)));
	} finally {
		translator.destroy();
	}
}

/**
 * Split markdown content into paragraphs, translate each, then rejoin.
 * Paragraph splitting avoids per-call character limits on large articles.
 */
export async function translateMarkdown(
	markdown: string,
	sourceLanguage: string,
	targetLanguage: string
): Promise<string> {
	const paragraphs = markdown.split(/\n{2,}/);
	const translated = await translateTexts(paragraphs, sourceLanguage, targetLanguage);
	return translated.join('\n\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the user's preferred language from the browser.
 * Returns the primary language subtag (e.g. "es" from "es-419").
 */
export function getBrowserLang(): string {
	if (typeof navigator === 'undefined') return 'en';
	return (navigator.language || 'en').split('-')[0];
}
