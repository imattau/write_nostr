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
		<a href="/" class="logo">write_nostr</a>
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
	}
	.logo {
		font-weight: 700;
		font-size: 1rem;
		color: var(--c-text);
		letter-spacing: -0.02em;
	}
	.nav-links {
		display: flex;
		align-items: center;
		gap: var(--space-md);
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
</style>
