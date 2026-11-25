<script lang="ts">
  import '../app.css';
  import '#lib/themes/themes.css';
  import '#lib/themes/decorations.css';
  import { goto } from '$app/navigation';
  import { installNativeHandlers } from '#lib/native.js';
  import NoticeBanner from '#lib/components/NoticeBanner.svelte';
  import { setupPush } from '#lib/push.js';
  import { update } from '#lib/update.svelte.js';
  import { session } from '#lib/session.svelte.js';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  // Register for push whenever someone is logged in.
  $effect(() => {
    if (session.ready && session.me) {
      void setupPush();
      void update.check();
    }
  });

  $effect(() => {
    void session.init();
    void installNativeHandlers((token) => {
      // A child scanned the QR with the system camera: open the join flow.
      void goto(`/join?t=${encodeURIComponent(token)}`);
    });
  });
</script>

<svelte:head>
  <title>Zadania</title>
</svelte:head>

{#if session.ready}
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
