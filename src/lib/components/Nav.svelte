<script lang="ts">
	import { page } from '$app/stores';
	import { auth, pubkey } from '$lib/stores/auth';
	import { profileCache, requestProfiles, displayName } from '$lib/stores/profiles';
	import { onMount } from 'svelte';

	// Fetch profile whenever pubkey changes
	$effect(() => {
		if ($pubkey) requestProfiles([$pubkey]);
	});
</script>

<nav class="nav">
	<div class="nav-inner container">
		<a href="/" class="logo" aria-label="write_nostr home">
			<img class="logo-mark" src="/brand/pen-logo-compact.png" alt="" aria-hidden="true" />
			<span class="logo-text">write_nostr</span>
		</a>
		<div class="nav-links">
			{#if $pubkey}
				<a href="/new" class="nav-link" class:active={$page.url.pathname === '/new'}>
					New Article
				</a>
				<a href="/drafts" class="nav-link" class:active={$page.url.pathname === '/drafts'}>
					Drafts
				</a>
				<a href="/settings" class="nav-link" class:active={$page.url.pathname === '/settings'}>
					Settings
				</a>
				<span class="pubkey" title={$pubkey}>{displayName($pubkey, $profileCache)}</span>
				<button onclick={() => auth.logout()}>Logout</button>
			{/if}
		</div>
	</div>
</nav>

<style>
	.nav {
		position: sticky;
		top: 0;
		z-index: 10;
		background: var(--c-surface);
		border-bottom: 1px solid var(--c-border);
	}
	.nav-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 48px;
		gap: var(--space-md);
	}
	.logo {
		display: inline-flex;
		align-items: center;
		gap: var(--space-sm);
		font-weight: 700;
		font-size: 1rem;
		color: var(--c-text);
		letter-spacing: -0.02em;
		flex-shrink: 0;
	}
	.logo-mark {
		width: 20px;
		height: 20px;
		display: block;
		object-fit: contain;
		flex-shrink: 0;
	}
	.logo-text {
		line-height: 1;
	}
	.nav-links {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.nav-link {
		font-size: 0.875rem;
		color: var(--c-text-secondary);
	}
	.nav-link.active {
		color: var(--c-accent);
	}
	.pubkey {
		font-size: 0.75rem;
		color: var(--c-text-secondary);
		background: var(--c-bg);
		padding: 2px 6px;
		border-radius: 4px;
		max-width: 14ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.nav-inner {
			height: auto;
			padding-top: var(--space-sm);
			padding-bottom: var(--space-sm);
			align-items: flex-start;
			flex-direction: column;
		}
		.nav-links {
			width: 100%;
			justify-content: flex-start;
			gap: var(--space-xs);
		}
		.logo-mark {
			width: 18px;
			height: 18px;
		}
		.nav-link,
		.pubkey,
		.nav-links button {
			font-size: 0.8125rem;
		}
		.pubkey {
			max-width: none;
			white-space: normal;
			word-break: break-word;
		}
	}
</style>
