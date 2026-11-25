<script lang="ts">
  import type { AlbumDto, CollectionDto } from '@choreapp/shared';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import ItemImage from '#lib/components/ItemImage.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { RARITY_LABEL } from '#lib/rarity.js';

  let album = $state<AlbumDto | null>(null);
  let error = $state('');
  let filter = $state<'all' | 'owned' | 'missing'>('all');

  $effect(() => {
    const name = decodeURIComponent(page.params.name!);
    api
      .get<CollectionDto>('/v1/members/me/collection')
      .then((c) => (album = c.albums.find((a) => a.name === name) ?? null))
      .catch((e) => (error = errorMessage(e)));
  });

  const shown = $derived(
    (album?.items ?? []).filter((i) => (filter === 'owned' ? i.owned : filter === 'missing' ? !i.owned : true)),
  );
</script>

<main class="screen">
  <BackHeader title={album?.name ?? 'Album'} back="/child/profile" />
  {#if error}<div class="error-box">{error}</div>{/if}
  {#if album}
    <p class="muted">Masz {album.owned} z {album.total}. Brakujące wypadają za zadania, część kupisz w Sklepie.</p>
    <div class="segmented">
      <button aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>Wszystkie</button>
      <button aria-pressed={filter === 'owned'} onclick={() => (filter = 'owned')}>Mam</button>
      <button aria-pressed={filter === 'missing'} onclick={() => (filter = 'missing')}>Brakuje</button>
    </div>
    <div class="grid">
      {#each shown as i (i.id)}
        <div class="cell" class:new={i.isNew}>
          <ItemImage url={i.imageUrl} name={i.name} rarity={i.rarity} locked={!i.owned} size={84} />
          <span class="name">{i.owned ? i.name : '???'}</span>
          {#if i.rarity !== 'common'}<span class="rarity {i.rarity}">{RARITY_LABEL[i.rarity]}</span>{/if}
        </div>
      {/each}
    </div>
  {/if}
</main>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 12px 8px;
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    position: relative;
  }
  .cell.new::after {
    content: 'Nowa!';
    position: absolute;
    top: -6px;
    right: 2px;
    background: var(--danger);
    color: #fff;
    font-size: 0.65rem;
    font-weight: 800;
    border-radius: 999px;
    padding: 2px 6px;
  }
  .name {
    font-size: 0.75rem;
    text-align: center;
    line-height: 1.15;
  }
  .rarity {
    font-size: 0.65rem;
    font-weight: 800;
  }
  .rarity.rare {
    color: #1d6fa5;
  }
  .rarity.legendary {
    color: #9a6b00;
  }
</style>
