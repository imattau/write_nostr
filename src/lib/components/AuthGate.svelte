<script lang="ts">
	import { auth, isAuthenticated } from '$lib/stores/auth';
	let { children } = $props();

	let nsecInput = $state('');
	let loading = $state(false);
	let error = $state('');

	async function handleLogin() {
		loading = true;
		error = '';
		try {
			await auth.loginWithNsec(nsecInput.trim());
		} catch (e) {
			error = 'Invalid nsec key. Please check and try again.';
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
				<button type="button" onclick={handleImportPasskey} disabled={loading || !nsecInput.trim()}>
					Create passkey from nsec
				</button>
			</form>

			{#if error}
				<p class="error">{error}</p>
			{/if}

			<p class="hint">
				Your private key never leaves your browser.
				Use a <a href="https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp" target="_blank">NIP-07 extension</a> for maximum security.
			</p>
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
