<script lang="ts">
  import type { ItemDto } from '@choreapp/shared';
  import { api } from '../api.js';
  import { RARITY_LABEL } from '../rarity.js';
  import ItemImage from './ItemImage.svelte';
  import Sheet from './Sheet.svelte';

  type NewItem = ItemDto & { how: 'drop' | 'streak' | 'shop' };

  let items = $state<NewItem[]>([]);
  let open = $state(false);
  let index = $state(0);

  /** Checks for stickers the child hasn't seen yet and shows them one by one. */
  export async function check(): Promise<void> {
    try {
      const fresh = await api.get<NewItem[]>('/v1/collection/new');
      if (fresh.length === 0) return;
      items = fresh;
      index = 0;
      open = true;
    } catch {
      /* offline: try next time */
    }
  }

  async function finish() {
    open = false;
    try {
      await api.post('/v1/collection/seen');
    } catch {
      /* will show again next time */
    }
  }

  const current = $derived(items[index]);
  const fromStreak = $derived(items.some((i) => i.how === 'streak'));
</script>

<Sheet bind:open onclose={finish} title={fromStreak ? 'Paczka za serię!' : 'Nowa naklejka!'}>
  {#if current}
    {#key current.id}
      <div class="reveal" data-rarity={current.rarity}>
        <div class="burst" aria-hidden="true"></div>
        <ItemImage url={current.imageUrl} name={current.name} rarity={current.rarity} size={160} />
        <h2>{current.name}</h2>
        <p class="muted">{RARITY_LABEL[current.rarity]} · album {current.album}</p>
      </div>
    {/key}
    {#if items.length > 1}<p class="center muted small">{index + 1} z {items.length}</p>{/if}
    {#if index < items.length - 1}
      <button class="btn primary block" onclick={() => index++}>Następna!</button>
    {:else}
      <button class="btn primary block" onclick={finish}>Do albumu!</button>
    {/if}
  {/if}
</Sheet>

<style>
  .reveal {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px 0;
    animation: pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  .burst {
    position: absolute;
    top: 0;
    width: 220px;
    height: 220px;
    border-radius: 50%;
    background: radial-gradient(circle, rgb(255 214 102 / 55%), transparent 65%);
    animation: spin 6s linear infinite;
    z-index: -1;
  }
  .reveal[data-rarity='legendary'] .burst {
    background: conic-gradient(from 0deg, #ffd166, #ff8fab, #9bf6ff, #caffbf, #ffd166);
    filter: blur(18px);
    opacity: 0.7;
  }
  @keyframes pop {
    from {
      transform: scale(0.3) rotate(-12deg);
      opacity: 0;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
