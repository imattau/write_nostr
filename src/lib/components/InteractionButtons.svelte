<script lang="ts">
	import { get } from 'svelte/store';
	import type { NostrEvent } from 'nostr-tools';
	import { SimplePool, nip57 } from 'nostr-tools';
	import { auth } from '$lib/stores/auth';
	import { relays } from '$lib/stores/relays';
	import { nwc } from '$lib/stores/nwc';
import { profileCache } from '$lib/stores/profiles';
import { publishLike, publishBoost } from '$lib/nostr/publish';

	let { event }: { event: NostrEvent } = $props();

	let liked = $state(false);
	let likeLoading = $state(false);
	let likeFetched = $state(false);

	let boostLoading = $state(false);
	let boosted = $state(false);

	type LnurlInfo = { callback: string; minSendable: number; maxSendable: number };
	const lnurlCache = new Map<string, LnurlInfo | null>();

	let showZapPopover = $state(false);
	let zapAmount = $state(21);
	let zapCustom = $state('');
	let zapLoading = $state(false);
	let zapError = $state('');
	let zapSuccess = $state(false);
	let zapInfo = $state<LnurlInfo | null | undefined>(undefined);
	let zapTooltip = $state('');
	let zapTooltipTimer: ReturnType<typeof setTimeout> | null = $state(null);

	let isAuthed = $derived($auth !== null);
	let nwcOk = $derived($nwc.connected);

	$effect(() => {
		if (event?.id && $auth && !likeFetched) checkExistingLike();
	});

	$effect(() => {
		$profileCache;
		if (!event?.pubkey || zapInfo !== undefined) return;
		if (lnurlCache.has(event.pubkey)) {
			const cached = lnurlCache.get(event.pubkey);
			zapInfo = cached ?? null;
			return;
		}
		resolveLnurlInfo();
	});

	async function checkExistingLike() {
		const signer = $auth;
		if (!signer) return;
		const relayList = get(relays);
		if (!relayList.length) return;
		const pool = new SimplePool();
		try {
			const evs = await pool.querySync(relayList, {
				kinds: [7],
				authors: [signer.pubkey],
				'#e': [event.id],
				limit: 1
			});
			liked = evs.length > 0 && evs[0].content === '+';
		} catch {
		} finally {
			pool.destroy();
			likeFetched = true;
		}
	}

	async function handleLike() {
		if (!isAuthed || likeLoading) return;
		likeLoading = true;
		try {
			const signer = $auth;
			if (!signer) return;
			const result = await publishLike(event, !liked, signer, get(relays));
			if (result.success) liked = !liked;
		} finally {
			likeLoading = false;
		}
	}

	async function handleBoost() {
		if (!isAuthed || boostLoading || boosted) return;
		boostLoading = true;
		try {
			const signer = $auth;
			if (!signer) return;
			const result = await publishBoost(event, signer, get(relays));
			if (result.success) boosted = true;
		} finally {
			boostLoading = false;
		}
	}

	function showTooltip(msg: string) {
		if (zapTooltipTimer) clearTimeout(zapTooltipTimer);
		zapTooltip = msg;
		zapTooltipTimer = setTimeout(() => { zapTooltip = ''; }, 3000);
	}

	async function resolveLnurlInfo() {
		const profile = $profileCache.get(event.pubkey);
		if (!profile || (!profile.lud06 && !profile.lud16)) {
			lnurlCache.set(event.pubkey, null);
			zapInfo = null;
			return;
		}
		try {
			let lnurlUrl: string;
			if (profile.lud16) {
				const [name, domain] = profile.lud16.split('@');
				lnurlUrl = `https://${domain}/.well-known/lnurlp/${name}`;
			} else {
				const { bech32 } = await import('@scure/base');
				const decoded = bech32.decode(profile.lud06! as `${string}1${string}`, 2000);
				const data = bech32.fromWords(decoded.words);
				lnurlUrl = new TextDecoder().decode(data);
			}
			const res = await fetch(lnurlUrl);
			const body = await res.json();
			if (!body.allowsNostr || !body.nostrPubkey) {
				lnurlCache.set(event.pubkey, null);
				zapInfo = null;
				return;
			}
			const info: LnurlInfo = {
				callback: body.callback,
				minSendable: body.minSendable || 1000,
				maxSendable: body.maxSendable || 100000000
			};
			lnurlCache.set(event.pubkey, info);
			zapInfo = info;
		} catch {
			lnurlCache.set(event.pubkey, null);
			zapInfo = null;
		}
	}

	function openZapPopover() {
		zapError = '';
		zapSuccess = false;
		if (!nwcOk) {
			showTooltip('Set up NWC in Settings to zap');
			return;
		}
		if (zapInfo) showZapPopover = true;
	}

	async function executeZap() {
		if (!zapInfo || !$auth || zapLoading) return;
		zapLoading = true;
		zapError = '';
		zapSuccess = false;
		try {
			const signer = $auth;
			const relayList = get(relays);
			const sats = zapCustom ? parseInt(zapCustom, 10) : zapAmount;
			const millisats = sats * 1000;
			if (millisats < zapInfo.minSendable || millisats > zapInfo.maxSendable) {
				zapError = `Amount must be between ${zapInfo.minSendable / 1000} and ${zapInfo.maxSendable / 1000} sats`;
				return;
			}
			const zapRequest = nip57.makeZapRequest({
				event,
				amount: millisats,
				relays: relayList
			}) as unknown as NostrEvent;
			zapRequest.pubkey = signer.pubkey;
			const signedZap = await signer.sign(zapRequest);
			const callbackUrl = new URL(zapInfo.callback);
			callbackUrl.searchParams.set('amount', String(millisats));
			callbackUrl.searchParams.set('nostr', JSON.stringify(signedZap));
			const cbRes = await fetch(callbackUrl.toString());
			const cbBody = await cbRes.json();
			if (!cbBody.pr) {
				zapError = 'Failed to get invoice from LNURL endpoint';
				return;
			}
			await nwc.payInvoice(cbBody.pr);
			zapSuccess = true;
			setTimeout(() => {
				showZapPopover = false;
				zapSuccess = false;
			}, 3000);
		} catch (e: any) {
			zapError = e.message || 'Zap failed';
		} finally {
			zapLoading = false;
		}
	}

	function closeZapPopover() {
		showZapPopover = false;
		zapError = '';
		zapSuccess = false;
	}

	const ZAP_PRESETS = [21, 100, 500, 1000];
</script>

<div class="interactions">
	<button
		class="icon-btn like-btn"
		class:active={liked}
		class:loading={likeLoading}
		onclick={handleLike}
		disabled={!isAuthed || likeLoading}
		title={liked ? 'Unlike' : 'Like'}
	>
		{#if liked}
			<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
				<path d="M8 14.5C2.5 9.5 1 6.5 1 4.5 1 2.5 2.5 1 4.5 1 5.9 1 7 1.8 8 3 9 1.8 10.1 1 11.5 1 13.5 1 15 2.5 15 4.5c0 2-1.5 5-7 10z"/>
			</svg>
		{:else}
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M8 14.5C2.5 9.5 1 6.5 1 4.5 1 2.5 2.5 1 4.5 1 5.9 1 7 1.8 8 3 9 1.8 10.1 1 11.5 1 13.5 1 15 2.5 15 4.5c0 2-1.5 5-7 10z"/>
			</svg>
		{/if}
	</button>

	<button
		class="icon-btn boost-btn"
		class:active={boosted}
		class:loading={boostLoading}
		onclick={handleBoost}
		disabled={!isAuthed || boostLoading || boosted}
		title="Boost"
	>
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
			stroke-linecap="round" stroke-linejoin="round">
			<path d="M2 3h10a2 2 0 012 2v3"/>
			<path d="M9 1l3 2-3 2"/>
			<path d="M14 13H4a2 2 0 01-2-2V8"/>
			<path d="M7 15l-3-2 3-2"/>
		</svg>
	</button>

	<button
		class="icon-btn zap-btn"
		class:loading={zapInfo === undefined}
		class:unavailable={zapInfo === null}
		onclick={openZapPopover}
		disabled={!isAuthed || !zapInfo}
		title={zapInfo === null ? 'Author does not accept zaps' : 'Zap'}
	>
		<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
			<path d="M7.5 1L2 9h4.5l-1 6L13 7H8.5L12 1H7.5z"/>
		</svg>
	</button>
</div>

{#if zapTooltip}
	<div class="zap-tooltip">{zapTooltip}</div>
{/if}

{#if showZapPopover}
	<div class="zap-overlay" onclick={closeZapPopover} onkeydown={(e) => e.key === 'Escape' && closeZapPopover()} role="presentation">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="zap-popover" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Send zap" tabindex="-1">
			<button class="zap-close" onclick={closeZapPopover}>&times;</button>
			<h3 class="zap-heading">Send Zap</h3>
			<div class="zap-presets">
				{#each ZAP_PRESETS as amt}
					<button
						class="zap-preset"
						class:selected={zapAmount === amt && !zapCustom}
						onclick={() => { zapAmount = amt; zapCustom = ''; }}
					>{amt}</button>
				{/each}
			</div>
			<div class="zap-custom">
				<input
					type="number"
					placeholder="Custom"
					min="1"
					bind:value={zapCustom}
					oninput={() => { if (zapCustom) zapAmount = 0; }}
				/>
				<span class="zap-suffix">sats</span>
			</div>
			{#if zapError}
				<p class="zap-error">{zapError}</p>
			{/if}
			{#if zapSuccess}
				<p class="zap-success">Zap sent!</p>
			{/if}
			<button class="zap-send primary" onclick={executeZap} disabled={zapLoading || zapSuccess}>
				{zapLoading ? 'Sending...' : 'Send'}
			</button>
		</div>
	</div>
{/if}

<style>
	.interactions {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		margin-left: auto;
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--c-text-secondary);
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}
	.icon-btn:hover:not(:disabled) {
		background: var(--c-bg);
		color: var(--c-text);
	}
	.icon-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.icon-btn.active {
		color: var(--c-accent);
	}
	.icon-btn.loading {
		opacity: 0.5;
		animation: pulse 1s ease-in-out infinite;
	}
	.like-btn.active svg {
		fill: var(--c-accent);
		stroke: var(--c-accent);
	}
	.boost-btn.active {
		color: #22c55e;
	}
	.zap-btn {
		color: #eab308;
	}
	.zap-btn.unavailable {
		opacity: 0.25;
	}
	.zap-tooltip {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 4px;
		padding: 4px 10px;
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		font-size: 0.75rem;
		color: var(--c-text-secondary);
		white-space: nowrap;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		z-index: 20;
		animation: fadeIn 0.15s ease-out;
	}
	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(-2px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes pulse {
		0%, 100% { opacity: 0.5; }
		50% { opacity: 1; }
	}
	.zap-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0,0,0,0.3);
	}
	.zap-popover {
		position: relative;
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		padding: var(--space-lg);
		width: 260px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.15);
	}
	.zap-close {
		position: absolute;
		top: var(--space-sm);
		right: var(--space-sm);
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		background: transparent;
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		color: var(--c-text-secondary);
	}
	.zap-heading {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: var(--space-md);
	}
	.zap-presets {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-xs);
		margin-bottom: var(--space-sm);
	}
	.zap-preset {
		padding: var(--space-sm);
		border: 1px solid var(--c-border);
		border-radius: var(--radius);
		background: var(--c-bg);
		font-size: 0.8125rem;
		text-align: center;
		cursor: pointer;
	}
	.zap-preset.selected {
		border-color: var(--c-accent);
		background: color-mix(in srgb, var(--c-accent) 10%, transparent);
		color: var(--c-accent);
	}
	.zap-custom {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-bottom: var(--space-md);
	}
	.zap-custom input {
		flex: 1;
		padding: var(--space-sm);
		font-size: 0.8125rem;
	}
	.zap-suffix {
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
		flex-shrink: 0;
	}
	.zap-error {
		color: var(--c-danger);
		font-size: 0.75rem;
		margin-bottom: var(--space-sm);
	}
	.zap-success {
		color: #22c55e;
		font-size: 0.8125rem;
		margin-bottom: var(--space-sm);
		font-weight: 600;
	}
	.zap-send {
		width: 100%;
		justify-content: center;
	}
</style>
