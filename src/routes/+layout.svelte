<script lang="ts">
	import { browser, dev } from '$app/environment';
	import '../app.css';
	import AuthGate from '$lib/components/AuthGate.svelte';
	import Nav from '$lib/components/Nav.svelte';
	import { auth, isAuthenticated, pubkey } from '$lib/stores/auth';
	import { relays } from '$lib/stores/relays';
	import { onMount } from 'svelte';
	import { pruneStaleCache } from '$lib/db';

	let { children } = $props();

	onMount(() => {
		auth.init();
		// Clean up stale IndexedDB records in the background — non-blocking
		pruneStaleCache().catch(() => {});

		if (browser && !dev && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js').catch((error) => {
				console.warn('[pwa] service worker registration failed:', error);
			});
		}
	});

	// When a pubkey becomes available after login, load the user's relay list.
	$effect(() => {
		if ($pubkey) {
			relays.loadFromNostr($pubkey);
		}
	});
</script>

<AuthGate>
	<Nav />
	<main class="container">
		{@render children()}
	</main>
</AuthGate>

<style>
	main {
		padding-bottom: var(--space-2xl);
	}
</style>
