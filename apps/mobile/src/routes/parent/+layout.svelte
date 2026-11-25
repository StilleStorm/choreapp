<script lang="ts">
  import { goto } from '$app/navigation';
  import TabBar, { type Tab } from '#lib/components/TabBar.svelte';
  import { api } from '#lib/api.js';
  import { pendingCounts } from '#lib/badges.svelte.js';
  import { session } from '#lib/session.svelte.js';
  import { dataThemeFor } from '#lib/themes/pickable.js';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  $effect(() => {
    if (!session.me) void goto('/welcome', { replaceState: true });
    else if (!session.isParent) void goto('/child', { replaceState: true });
  });

  // Keep the approvals badge fresh even when the Today tab isn't open.
  $effect(() => {
    if (!session.isParent) return;
    const refresh = () => {
      api
        .get<unknown[]>('/v1/approvals')
        .then((a) => (pendingCounts.approvals = a.length))
        .catch(() => {});
      api
        .get<unknown[]>('/v1/redemptions?status=requested')
        .then((r) => (pendingCounts.redemptions = r.length))
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  });

  // Adults keep the neutral base style unless they picked a theme.
  $effect(() => {
    const theme = dataThemeFor(session.me?.theme);
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    return () => delete document.documentElement.dataset.theme;
  });

  const tabs: Tab[] = $derived([
    { href: '/parent/today', label: 'Dziś', icon: 'today', badge: pendingCounts.approvals },
    { href: '/parent/week', label: 'Tydzień', icon: 'week' },
    { href: '/parent/tasks', label: 'Zadania', icon: 'tasks' },
    { href: '/parent/kids', label: 'Dzieci', icon: 'kids' },
    { href: '/parent/rewards', label: 'Nagrody', icon: 'gift', badge: pendingCounts.redemptions },
    { href: '/parent/settings', label: 'Ustawienia', icon: 'settings' },
  ]);
</script>

{#if session.isParent}
  {@render children()}
  <TabBar {tabs} />
{/if}
