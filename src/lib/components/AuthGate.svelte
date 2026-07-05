<script lang="ts">
	import { auth, isAuthenticated } from '$lib/stores/auth';
	import { isTauri } from '$lib/utils/env';
	let { children } = $props();

	let nsecInput = $state('');
	let loading = $state(false);
	let error = $state('');
	let rememberKeychain = $state(false);

	const runningInTauri = isTauri();

	async function handleLogin() {
		loading = true;
		error = '';
		try {
			await auth.loginWithNsec(nsecInput.trim());
		} catch (e) {
			error = 'Invalid nsec key. Please check and try again.';
			loading = false;
			return;
		}
		if (rememberKeychain) {
			try {
				await auth.storeKeychainLogin(nsecInput.trim());
			} catch (e) {
				console.warn('[auth] failed to store in system keychain:', e);
			}
		}
		loading = false;
	}

	async function handleExtension() {
		loading = true;
		error = '';
		try {
			const signer = await auth.detectExtension();
			if (!signer) {
				error = 'No NIP-07 extension detected.';
			}
		} catch (e) {
			error = 'Failed to connect extension.';
		}
		loading = false;
	}

	async function handlePasskey() {
		loading = true;
		error = '';
		try {
			await auth.loginWithPasskey();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to unlock passkey.';
		}
		loading = false;
	}

	async function handleImportPasskey() {
		loading = true;
		error = '';
		try {
			await auth.importPasskeyFromNsec(nsecInput.trim());
			nsecInput = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to import passkey.';
		}
		loading = false;
	}
</script>

{#if !$isAuthenticated}
	<div class="auth-gate">
		<div class="auth-card">
			<h1>write_nostr</h1>
			<p class="subtitle">A minimalist writing space on Nostr</p>

			{#if !runningInTauri}
				<button class="primary" onclick={handleExtension} disabled={loading}>
					{loading ? 'Connecting...' : 'Connect with Browser Extension'}
				</button>

				<button onclick={handlePasskey} disabled={loading}>
					{loading ? 'Unlocking...' : 'Login with Passkey'}
				</button>

				<p class="hint">
					Passkey login uses a device-bound credential. If you have an `nsec`, you can import it
					into a passkey below once, then use biometrics or device PIN next time.
				</p>

				<div class="divider"><span>or</span></div>
			{/if}

			<form onsubmit={(e) => { e.preventDefault(); handleLogin(); }}>
				<input
					type="text"
					inputmode="text"
					autocomplete="off"
					placeholder="Paste your nsec..."
					bind:value={nsecInput}
					disabled={loading}
				/>
				<button class="primary" type="submit" disabled={loading || !nsecInput.trim()}>
					Login with nsec
				</button>
				{#if runningInTauri}
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={rememberKeychain} />
						Remember in system keychain
					</label>
				{/if}
				{#if !runningInTauri}
					<button type="button" onclick={handleImportPasskey} disabled={loading || !nsecInput.trim()}>
						Create passkey from nsec
					</button>
				{/if}
			</form>

			{#if error}
				<p class="error">{error}</p>
			{/if}

			{#if !runningInTauri}
				<div class="security-warning">
					<p class="hint">
						⚠️ Logging in with an <strong>nsec</strong> key directly exposes it to the browser's session storage. For maximum security, use a <a href="https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp" target="_blank">NIP-07 extension</a> or create a <strong>Passkey</strong>.
					</p>
				</div>
			{/if}
		</div>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.auth-gate {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--space-md);
	}
	.auth-card {
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}
	h1 {
		font-size: 1.75rem;
		font-weight: 700;
		text-align: center;
	}
	.subtitle {
		text-align: center;
		color: var(--c-text-secondary);
		font-size: 0.875rem;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		color: var(--c-text-secondary);
		font-size: 0.75rem;
	}
	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--c-border);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}
	.error {
		color: var(--c-danger);
		font-size: 0.8125rem;
	}
	.hint {
		font-size: 0.75rem;
		color: var(--c-text-secondary);
		text-align: center;
	}
	button {
		width: 100%;
		justify-content: center;
	}
	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		font-size: 0.8125rem;
		color: var(--c-text-secondary);
		cursor: pointer;
	}
	.checkbox-label input {
		width: auto;
	}

	@media (max-width: 640px) {
		.auth-gate {
			padding: var(--space-sm);
			align-items: flex-start;
		}
		.auth-card {
			max-width: none;
			gap: var(--space-sm);
		}
		h1 {
			font-size: 1.5rem;
		}
		.subtitle,
		.hint {
			font-size: 0.8125rem;
		}
		.divider {
			gap: var(--space-sm);
		}
		.divider::before,
		.divider::after {
			min-width: 12px;
		}
	}
</style>
