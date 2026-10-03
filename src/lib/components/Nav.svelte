<script lang="ts">
	import { page } from '$app/stores';
	import { auth, pubkey } from '$lib/stores/auth';
	import { profileCache, requestProfiles, displayName } from '$lib/stores/profiles';
	import { onMount } from 'svelte';
	let menuOpen = $state(false);

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
		{#if $pubkey}
			<button
				class="menu-toggle"
				aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
				aria-expanded={menuOpen}
				aria-controls="primary-navigation"
				onclick={() => (menuOpen = !menuOpen)}
			>
				<span></span><span></span><span></span>
			</button>
		{/if}
		<div class="nav-links" id="primary-navigation" class:open={menuOpen}>
			{#if $pubkey}
				<a href="/new" class="nav-link" class:active={$page.url.pathname === '/new'} onclick={() => (menuOpen = false)}>
					New Article
				</a>
				<a href="/drafts" class="nav-link" class:active={$page.url.pathname === '/drafts'} onclick={() => (menuOpen = false)}>
					Drafts
				</a>
				<a href="/settings" class="nav-link" class:active={$page.url.pathname === '/settings'} onclick={() => (menuOpen = false)}>
					Settings
				</a>
				<span class="pubkey" title={$pubkey}>{displayName($pubkey, $profileCache)}</span>
				<button onclick={() => { menuOpen = false; auth.logout(); }}>Logout</button>
			{/if}
		</div>
	</div>
</nav>

<style>
	.nav {
		position: sticky;
		top: var(--safe-area-top);
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
		font-size: 1rem;
		color: var(--c-text-secondary);
	}
	.menu-toggle { display: none; }
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
			position: relative;
			height: 56px;
			padding-top: 0;
			padding-bottom: 0;
			align-items: center;
			flex-direction: row;
		}
		.menu-toggle {
			display: flex;
			width: 48px;
			height: 48px;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 5px;
			padding: 10px;
			border: 1px solid var(--c-border);
			border-radius: 8px;
			background: var(--c-surface);
			color: var(--c-text);
			cursor: pointer;
		}
		.menu-toggle span { display: block; width: 20px; height: 2px; border-radius: 2px; background: currentColor; }
		.nav-links {
			display: none;
			position: absolute;
			top: calc(100% - 1px);
			left: 0;
			right: 0;
			z-index: 11;
			width: auto;
			padding: var(--space-sm);
			flex-direction: column;
			align-items: stretch;
			gap: 4px;
			background: var(--c-surface);
			border: 1px solid var(--c-border);
			border-radius: 0 0 10px 10px;
			box-shadow: 0 8px 20px rgb(0 0 0 / 12%);
		}
		.nav-links.open { display: flex; }
		.nav-links .nav-link,
		.nav-links > button { display: flex; align-items: center; min-height: 48px; padding: 10px 12px; font-size: 1.0625rem; }
		.nav-links .nav-link { border-radius: 6px; }
		.nav-links .nav-link.active { background: var(--c-bg); }
		.nav-links > button { justify-content: flex-start; }
		.pubkey { font-size: 0.9375rem; padding: 8px 12px; }
		.logo-mark {
			width: 22px;
			height: 22px;
		}
	}

	/* Touch-first tablets have room for larger type and taller navigation targets. */
	@media (min-width: 641px) and (pointer: coarse) {
		.nav-inner { min-height: 64px; height: auto; padding-top: var(--space-sm); padding-bottom: var(--space-sm); }
		.nav-links { gap: var(--space-lg); }
		.nav-link { font-size: 1.125rem; }
		.nav-links > button { min-height: 48px; font-size: 1rem; }
		.pubkey { font-size: 0.875rem; padding: 6px 10px; }
		.logo { font-size: 1.125rem; }
		.logo-mark { width: 24px; height: 24px; }
	}
</style>
