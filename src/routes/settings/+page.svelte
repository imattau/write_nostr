<script lang="ts">
	import { relays, loadingRelays } from '$lib/stores/relays';
	import { auth, pubkey } from '$lib/stores/auth';
	import { nwc } from '$lib/stores/nwc';

	let newRelay = $state('');
	let message = $state('');
	let nwcInput = $state('');
	let nwcMessage = $state('');

	async function connectNwc() {
		try {
			nwc.connect(nwcInput.trim());
			nwcInput = '';
			nwcMessage = 'Wallet connected!';
			setTimeout(() => (nwcMessage = ''), 3000);
		} catch {
			nwcMessage = 'Invalid connection string';
		}
	}

	async function checkBalance() {
		try {
			await nwc.getBalance();
		} catch (e: any) {
			nwcMessage = e.message || 'Failed to fetch balance';
			setTimeout(() => (nwcMessage = ''), 3000);
		}
	}

	function disconnectNwc() {
		nwc.disconnect();
		nwcMessage = 'Wallet disconnected';
		setTimeout(() => (nwcMessage = ''), 3000);
	}

	function addRelay() {
		const url = newRelay.trim();
		if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
			message = 'Relay URL must start with wss:// or ws://';
			return;
		}
		relays.add(url);
		newRelay = '';
		message = '';
	}

	function copyPubkey() {
		if ($pubkey) {
			navigator.clipboard.writeText($pubkey);
			message = 'Public key copied!';
		}
	}

	async function refreshFromNostr() {
		if (!$pubkey) return;
		// Clear cached per-pubkey list so it re-fetches
		localStorage.removeItem(`write_relays_${$pubkey}`);
		await relays.loadFromNostr($pubkey);
		message = 'Relay list refreshed from Nostr!';
		setTimeout(() => (message = ''), 3000);
	}
</script>

<div class="settings">
	<h1>Settings</h1>

	<section>
		<h2>Relays</h2>
		<p class="desc">Relays are used to publish and fetch articles. Loaded from your Nostr relay list (NIP-65) on login.</p>
		{#if $loadingRelays}
			<p class="loading-relays">⟳ Fetching your relay list from Nostr…</p>
		{/if}
		<div class="relay-list">
			{#each $relays as relay (relay)}
				<div class="relay-item">
					<span class="relay-url">{relay}</span>
					<button class="remove" onclick={() => relays.remove(relay)}>Remove</button>
				</div>
			{/each}
		</div>
		<form class="add-relay" onsubmit={(e) => { e.preventDefault(); addRelay(); }}>
			<input
				type="text"
				placeholder="wss://relay.example.com"
				bind:value={newRelay}
			/>
			<button type="submit" disabled={!newRelay.trim()}>Add</button>
		</form>
		<div class="relay-actions">
			<button class="reset" onclick={() => relays.reset()}>Reset to defaults</button>
			<button class="refresh" onclick={refreshFromNostr} disabled={$loadingRelays || !$pubkey}>
				{$loadingRelays ? 'Fetching…' : 'Refresh from Nostr'}
			</button>
		</div>
	</section>

	<section>
		<h2>Account</h2>
		{#if $pubkey}
			<div class="pubkey-display">
				<span class="label">Public Key</span>
				<code>{$pubkey}</code>
				<button onclick={copyPubkey}>Copy</button>
			</div>
			<button class="danger" onclick={() => auth.logout()}>Logout</button>
		{/if}
	</section>

	<section>
		<h2>Wallet</h2>
		<p class="desc">Connect a Nostr Wallet Connect (NWC) wallet to send zaps on articles.</p>
		{#if $nwc.connected}
			<div class="nwc-status">
				<span class="nwc-connected">Connected</span>
				<code class="nwc-pubkey" title={$nwc.walletPubkey}>
					{$nwc.walletPubkey.slice(0, 8)}...{$nwc.walletPubkey.slice(-4)}
				</code>
			</div>
			<div class="nwc-balance">
				<span class="label">Balance</span>
				<code>{$nwc.balance !== null ? $nwc.balance.toLocaleString() + ' sats' : 'Unknown'}</code>
				<button class="refresh" onclick={checkBalance} disabled={$nwc.balance === null}>Refresh</button>
			</div>
			<button class="danger" onclick={disconnectNwc}>Disconnect</button>
		{:else}
			<form class="nwc-connect" onsubmit={(e) => { e.preventDefault(); connectNwc(); }}>
				<input
					type="text"
					placeholder="nostr+walletconnect://..."
					bind:value={nwcInput}
				/>
				<button type="submit" disabled={!nwcInput.trim()}>Connect</button>
			</form>
		{/if}
		{#if nwcMessage}
			<p class="nwc-message">{nwcMessage}</p>
		{/if}
	</section>

	<section>
		<h2>About</h2>
		<p class="desc">
			write_nostr is a minimalist long-form writing app for Nostr.
			Articles are published as NIP-23 kind:30023 events to your configured relays.
		</p>
	</section>

	{#if message}
		<p class="message">{message}</p>
	{/if}
</div>

<style>
	.settings {
		padding: var(--space-xl) 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2xl);
	}
	h1 {
		font-size: 1.25rem;
		font-weight: 600;
	}
	h2 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: var(--space-sm);
	}
	.desc {
		font-size: 0.875rem;
		color: var(--c-text-secondary);
		margin-bottom: var(--space-md);
	}
	section {
		padding-bottom: var(--space-lg);
		border-bottom: 1px solid var(--c-border);
	}
	.loading-relays {
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
		margin-bottom: var(--space-sm);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}
	.relay-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		margin-bottom: var(--space-md);
	}
	.relay-actions {
		display: flex;
		gap: var(--space-sm);
		flex-wrap: wrap;
	}
	.refresh {
		font-size: 0.8125rem;
	}
	.relay-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-sm) var(--space-md);
		background: var(--c-bg);
		border-radius: var(--radius);
	}
	.relay-url {
		font-size: 0.8125rem;
		font-family: var(--font-mono);
	}
	.remove {
		font-size: 0.75rem;
		padding: 2px 8px;
		color: var(--c-danger);
		border-color: var(--c-danger);
	}
	.add-relay {
		display: flex;
		gap: var(--space-sm);
		margin-bottom: var(--space-sm);
	}
	.add-relay input {
		flex: 1;
	}
	.reset {
		font-size: 0.8125rem;
	}
	.pubkey-display {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-bottom: var(--space-md);
		flex-wrap: wrap;
	}
	.pubkey-display .label {
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
	}
	.pubkey-display code {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		background: var(--c-bg);
		padding: 4px 8px;
		border-radius: 4px;
		word-break: break-all;
	}
	.danger {
		color: var(--c-danger);
		border-color: var(--c-danger);
	}
	.nwc-status {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-bottom: var(--space-sm);
	}
	.nwc-connected {
		font-size: 0.8125rem;
		color: #22c55e;
		font-weight: 600;
	}
	.nwc-pubkey {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		background: var(--c-bg);
		padding: 2px 6px;
		border-radius: 4px;
	}
	.nwc-balance {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-bottom: var(--space-md);
	}
	.nwc-balance .label {
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
	}
	.nwc-balance code {
		font-size: 0.8125rem;
		font-family: var(--font-mono);
	}
	.nwc-connect {
		display: flex;
		gap: var(--space-sm);
		margin-bottom: var(--space-sm);
	}
	.nwc-connect input {
		flex: 1;
	}
	.nwc-message {
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
		margin-top: var(--space-sm);
	}
	.message {
		position: fixed;
		bottom: var(--space-md);
		left: 50%;
		transform: translateX(-50%);
		background: var(--c-surface);
		border: 1px solid var(--c-border);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius);
		font-size: 0.875rem;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
	}

	@media (max-width: 640px) {
		.settings {
			padding: var(--space-lg) 0;
			gap: var(--space-xl);
		}
		section {
			padding-bottom: var(--space-md);
		}
		.relay-item {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--space-sm);
		}
		.relay-url {
			word-break: break-word;
		}
		.add-relay {
			flex-direction: column;
		}
		.relay-actions {
			flex-direction: column;
		}
		.relay-actions button,
		.add-relay button,
		.pubkey-display button,
		.danger {
			width: 100%;
		}
		.pubkey-display {
			align-items: flex-start;
		}
		.message {
			left: var(--space-md);
			right: var(--space-md);
			bottom: var(--space-md);
			transform: none;
			width: auto;
		}
	}
</style>
