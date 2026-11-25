<script lang="ts">
  import type { ItemDto } from '@choreapp/shared';
  import type { Snippet } from 'svelte';
  import { groupThemeAvatars } from '../themeAvatars.js';

  /**
   * Built-in theme avatars (free for everyone): the member's own theme first
   * ("Twój motyw"), then `children` (e.g. avatars from the shop), then the
   * other themes, each under its name.
   */
  let {
    avatars,
    theme,
    selectedId,
    onpick,
    children,
  }: {
    avatars: ItemDto[];
    theme: string | undefined;
    selectedId: string | null;
    onpick: (item: ItemDto) => void;
    children?: Snippet;
  } = $props();

  const groups = $derived(groupThemeAvatars(avatars, theme));
</script>

{#snippet grid(items: ItemDto[])}
  <div class="grid">
    {#each items as a (a.id)}
      <button class="pick" aria-pressed={selectedId === a.id} aria-label={`${a.album}: ${a.name}`} onclick={() => onpick(a)}>
        <img src={a.imageUrl} alt="" width="64" height="64" loading="lazy" decoding="async" />
      </button>
    {/each}
  </div>
{/snippet}

{#if groups.own.length}
  <h3 class="section-title">Twój motyw</h3>
  {@render grid(groups.own)}
{/if}
{@render children?.()}
{#if groups.others.length}
  <h3 class="section-title">{groups.own.length ? 'Inne motywy' : 'Awatary motywów'}</h3>
{/if}
{#each groups.others as g (g.theme)}
  <h4 class="theme-title muted">{g.title}</h4>
  {@render grid(g.items)}
{/each}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 8px;
    margin-bottom: 8px;
  }
  .pick {
    appearance: none;
    border: 2px solid transparent;
    background: var(--surface-2);
    border-radius: 14px;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    cursor: pointer;
  }
  .pick[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .pick img {
    width: 100%;
    max-width: 72px;
    height: auto;
    border-radius: 50%;
  }
  .theme-title {
    margin: 10px 0 6px;
    font-size: 0.85rem;
    font-weight: 700;
  }
</style>
