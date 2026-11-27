<script lang="ts">
  import type { ItemDto, RewardDto, ShopDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Icon from '#lib/components/Icon.svelte';
  import ItemImage from '#lib/components/ItemImage.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import TaskIcon from '#lib/components/TaskIcon.svelte';
  import { plural } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { KIND_LABEL, RARITY_LABEL } from '#lib/rarity.js';
  import { session } from '#lib/session.svelte.js';

  let shop = $state<ShopDto | null>(null);
  let error = $state('');
  let tab = $state<'sticker' | 'avatar' | 'frame'>('sticker');

  async function load() {
    try {
      shop = await api.get<ShopDto>('/v1/shop');
    } catch (e) {
      error = errorMessage(e);
    }
  }
  $effect(() => {
    void load();
  });

  // Confirmation sheet for both kinds of purchase
  let open = $state(false);
  let reward = $state<RewardDto | null>(null);
  let item = $state<ItemDto | null>(null);
  let busy = $state(false);
  let result = $state('');
  let buyError = $state('');

  function pickReward(r: RewardDto) {
    reward = r;
    item = null;
    result = '';
    buyError = '';
    open = true;
  }
  function pickItem(i: ItemDto) {
    if (i.owned) return;
    item = i;
    reward = null;
    result = '';
    buyError = '';
    open = true;
  }
  const cost = $derived(reward?.cost ?? item?.price ?? 0);
  const enough = $derived((shop?.balance ?? 0) >= cost);

  async function buy() {
    busy = true;
    buyError = '';
    try {
      if (reward) {
        await api.post(`/v1/rewards/${reward.id}/redeem`);
        result = `Wybrane! ${session.parents.length > 1 ? 'Rodzice dostali' : 'Rodzic dostał'} powiadomienie.`;
      } else if (item) {
        await api.post(`/v1/shop/items/${item.id}/buy`);
        result = item.kind === 'sticker' ? 'Naklejka jest już w Twoim albumie!' : 'Masz to! Ustawisz w Profilu.';
      }
      await load();
    } catch (e) {
      buyError = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  // Cheapest first inside each album; not-yet-owned before owned.
  const items = $derived(
    (shop?.items ?? [])
      .filter((i) => i.kind === tab)
      .sort((a, b) => Number(a.owned) - Number(b.owned) || (a.price ?? 0) - (b.price ?? 0) || a.name.localeCompare(b.name, 'pl')),
  );
  const albums = $derived([...new Set(items.map((i) => i.album))]);
  let expanded = $state(new Set<string>());
</script>

<main class="screen">
  <header class="screen-header">
    <h1>Sklep</h1>
    {#if shop}<span class="balance-pill"><Icon name="star" size={18} /> {shop.balance}</span>{/if}
  </header>
  {#if error}<div class="error-box">{error}</div>{/if}

  {#if shop}
    {#if shop.pending.length > 0}
      <section class="section">
        <h2 class="section-title">Czekają na wydanie</h2>
        <div class="list">
          {#each shop.pending as p (p.id)}
            <div class="row">
              <TaskIcon icon={p.rewardIcon} size={36} />
              <span class="grow title">{p.rewardName}</span>
              <span class="badge warning">czeka</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if shop.rewards.length > 0}
      <section class="section">
        <h2 class="section-title">Nagrody od rodziców</h2>
        <div class="rewards">
          {#each shop.rewards as r (r.id)}
            <button class="card reward" onclick={() => pickReward(r)}>
              <TaskIcon icon={r.icon} size={48} />
              <span class="name">{r.name}</span>
              {#if r.oneTime}<span class="badge">jednorazowa</span>{/if}
              <span class="price" class:short={shop.balance < r.cost}>{r.cost} pkt</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <section class="section">
      <h2 class="section-title">Rzeczy cyfrowe</h2>
      <div class="segmented" role="tablist">
        <button aria-pressed={tab === 'sticker'} onclick={() => (tab = 'sticker')}>Naklejki</button>
        <button aria-pressed={tab === 'avatar'} onclick={() => (tab = 'avatar')}>Awatary</button>
        <button aria-pressed={tab === 'frame'} onclick={() => (tab = 'frame')}>Ramki</button>
      </div>
      {#each albums as album (album)}
        {@const inAlbum = items.filter((i) => i.album === album)}
        {@const visible = expanded.has(album) ? inAlbum : inAlbum.slice(0, 9)}
        {#if albums.length > 1}<h3 class="album-title">{album}</h3>{/if}
        <div class="grid">
          {#each visible as i (i.id)}
            <button class="cell" onclick={() => pickItem(i)} disabled={i.owned} aria-label="{i.name}, {i.price} punktów">
              <ItemImage url={i.imageUrl} name={i.name} rarity={i.rarity} size={76} />
              <span class="cell-name">{i.name}</span>
              {#if i.owned}
                <span class="owned">Masz ✓</span>
              {:else}
                <span class="price" class:short={shop.balance < (i.price ?? 0)}>{i.price} pkt</span>
              {/if}
            </button>
          {/each}
        </div>
        {#if inAlbum.length > visible.length}
          <button class="btn ghost small" onclick={() => (expanded = new Set([...expanded, album]))}>
            Pokaż wszystkie ({inAlbum.length})
          </button>
        {/if}
      {:else}
        <p class="empty">Nic tu teraz nie ma.</p>
      {/each}
    </section>
  {:else if !error}
    <p class="empty">Wczytywanie…</p>
  {/if}
</main>

<Sheet bind:open title={reward ? 'Nagroda' : item ? KIND_LABEL[item.kind] : ''}>
  <div class="confirm">
    {#if reward}
      <TaskIcon icon={reward.icon} size={88} />
      <h2>{reward.name}</h2>
      {#if reward.oneTime}<p class="muted small">Jednorazowa: po wybraniu zniknie ze sklepu.</p>{/if}
    {:else if item}
      <ItemImage url={item.imageUrl} name={item.name} rarity={item.rarity} size={120} />
      <h2>{item.name}</h2>
      <span class="badge">{RARITY_LABEL[item.rarity]}</span>
    {/if}
    {#if result}
      <p class="success-text">{result}</p>
      <button class="btn primary block" onclick={() => (open = false)}>Super!</button>
    {:else}
      <p>Koszt: <strong>{cost} pkt</strong> · masz {shop?.balance ?? 0}</p>
      {#if !enough}
        <p class="muted">Brakuje Ci {cost - (shop?.balance ?? 0)} {plural(cost - (shop?.balance ?? 0), 'punktu', 'punktów', 'punktów')}. Zrób jeszcze kilka zadań!</p>
      {/if}
      {#if buyError}<div class="error-box">{buyError}</div>{/if}
      <button class="btn primary block" disabled={!enough || busy} onclick={buy}>
        {busy ? 'Chwileczkę…' : reward ? 'Wybieram!' : 'Kupuję!'}
      </button>
    {/if}
  </div>
</Sheet>

<style>
  .balance-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--hero-bg, var(--accent-soft));
    color: var(--hero-text, var(--accent));
    font-weight: 800;
    border-radius: 999px;
    padding: 6px 14px;
  }
  .rewards {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .reward {
    appearance: none;
    border: var(--card-border, 0);
    font: inherit;
    color: inherit;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    text-align: center;
  }
  .reward .name {
    font-weight: 700;
  }
  .price {
    font-weight: 800;
    color: var(--points, var(--accent));
  }
  .price.short {
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px;
  }
  .cell {
    appearance: none;
    border: 0;
    background: var(--surface);
    border-radius: var(--radius);
    padding: 8px 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    box-shadow: var(--shadow);
  }
  .cell:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .album-title {
    font-size: 0.95rem;
    margin-top: 6px;
  }
  .cell-name {
    font-size: 0.75rem;
    text-align: center;
    line-height: 1.15;
  }
  .owned {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--success);
  }
  .confirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }
  .success-text {
    color: var(--success);
    font-weight: 700;
  }
</style>
