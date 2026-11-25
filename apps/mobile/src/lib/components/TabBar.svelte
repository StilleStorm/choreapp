<script lang="ts">
  import { page } from '$app/state';
  import Icon, { type IconName } from './Icon.svelte';

  export interface Tab {
    href: string;
    label: string;
    icon: IconName;
    badge?: number;
    /** Match only the exact path (for the section root). */
    exact?: boolean;
  }

  let { tabs }: { tabs: Tab[] } = $props();

  function active(t: Tab): boolean {
    const p = page.url.pathname.replace(/\/$/, '');
    return t.exact ? p === t.href : p === t.href || p.startsWith(`${t.href}/`);
  }
</script>

<nav class="tabbar" aria-label="Nawigacja">
  {#each tabs as t (t.href)}
    <a href={t.href} aria-current={active(t) ? 'page' : undefined}>
      <Icon name={t.icon} size={24} stroke={active(t) ? 2.4 : 2} />
      <span>{t.label}</span>
      {#if t.badge}<span class="dot">{t.badge}</span>{/if}
    </a>
  {/each}
</nav>
