<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '#lib/components/Icon.svelte';
  import PackOpening from '#lib/components/PackOpening.svelte';
  import TabBar, { type Tab } from '#lib/components/TabBar.svelte';
  import { doneLabel } from '#lib/doneLabel.svelte.js';
  import { offline } from '#lib/offline.svelte.js';
  import { packs } from '#lib/packs.svelte.js';
  import { session } from '#lib/session.svelte.js';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  $effect(() => {
    if (!session.me) void goto('/welcome', { replace: true });
    else if (session.isParent) void goto('/parent', { replace: true });
  });

  // The whole page (body, sheets, tab bar) follows the child's theme.
  $effect(() => {
    const theme = session.me?.theme;
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    return () => delete document.documentElement.dataset.theme;
  });

  $effect(() => {
    void offline.init();
    void doneLabel.load();
  });

  // New stickers (approved tasks, streak packs) come as packs to open when the app is opened.
  $effect(() => {
    if (!session.me || session.isParent) return;
    void packs.check();
    const onVisible = () => document.visibilityState === 'visible' && void packs.check();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  const tabs: Tab[] = [
    { href: '/child/today', label: 'Dziś', icon: 'today' },
    { href: '/child/week', label: 'Tydzień', icon: 'week' },
    { href: '/child/points', label: 'Punkty', icon: 'star' },
    { href: '/child/shop', label: 'Sklep', icon: 'shop' },
    { href: '/child/profile', label: 'Profil', icon: 'user' },
  ];
</script>

{#if session.me && !session.isParent}
  <div class="child-app">
    {#if session.activeFamilyName}
      <!-- Several homes on this phone: always show which one is open. -->
      <a class="home-line" href="/child/profile"><Icon name="home" size={16} /> {session.activeFamilyName}</a>
    {/if}
    {@render children()}
    <TabBar {tabs} />
    <PackOpening />
  </div>
{/if}

<style>
  .home-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: calc(var(--safe-top) + 8px) 16px 0;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--muted);
    text-decoration: none;
  }
  .home-line + :global(.screen) {
    padding-top: 8px;
  }
</style>
