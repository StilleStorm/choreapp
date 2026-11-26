<script lang="ts">
  import '../app.css';
  import '#lib/themes/themes.css';
  import '#lib/themes/decorations.css';
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { installNativeHandlers } from '#lib/native.js';
  import NoticeBanner from '#lib/components/NoticeBanner.svelte';
  import { setupPush } from '#lib/push.js';
  import { update } from '#lib/update.svelte.js';
  import { session } from '#lib/session.svelte.js';
  import { swapRedirect } from '#lib/swap.js';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  // Register for push whenever someone logs in (not on every /me refresh).
  const signedInAs = $derived(session.ready ? (session.me?.id ?? null) : null);
  $effect(() => {
    if (!signedInAs) return;
    untrack(() => {
      void setupPush();
      void update.check();
    });
  });

  // A child using a parent's phone: adult screens, login and joining are out of reach (deep links too).
  const swapTarget = $derived(session.ready && session.swapped ? swapRedirect(page.url.pathname, !!session.me && !session.isParent) : null);
  $effect(() => {
    if (swapTarget) void goto(swapTarget, { replace: true });
  });

  onMount(() => {
    void session.init();
    void installNativeHandlers((token) => {
      // A child scanned the QR with the system camera: open the join flow.
      void goto(`/join?t=${encodeURIComponent(token)}`);
    });
    const onVisible = () => document.visibilityState === 'visible' && void session.resume();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
</script>

<svelte:head>
  <title>Zadania</title>
</svelte:head>

{#if session.ready && !swapTarget}
  {@render children()}
  <NoticeBanner />
{:else}
  <div class="splash" aria-busy="true"></div>
{/if}

<style>
  .splash {
    min-height: 100dvh;
    background: var(--bg);
  }
</style>
