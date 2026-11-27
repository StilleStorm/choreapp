<script lang="ts">
  import { CUSTOM_PACKS_ENABLED } from '@choreapp/shared';
  import type { Rarity } from '@choreapp/core';
  import type { ItemDto, PackDto } from '@choreapp/shared';
  import { page } from '$app/state';
  import { api, request } from '#lib/api.js';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import ItemImage from '#lib/components/ItemImage.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { KIND_LABEL, RARITY_LABEL } from '#lib/rarity.js';

  let pack = $state<PackDto | null>(null);
  let items = $state<ItemDto[]>([]);
  let error = $state('');

  async function load() {
    try {
      const [packs, list] = await Promise.all([api.get<PackDto[]>('/v1/packs'), api.get<ItemDto[]>(`/v1/packs/${page.params.id}/items`)]);
      pack = packs.find((p) => p.id === page.params.id) ?? null;
      items = list;
    } catch (e) {
      error = errorMessage(e);
    }
  }
  $effect(() => {
    void load();
  });

  const albums = $derived([...new Set(items.map((i) => i.album))]);

  // Upload
  let files = $state<FileList | null>(null);
  let album = $state('');
  let rarity = $state<Rarity>('common');
  let kind = $state<'sticker' | 'avatar' | 'frame'>('sticker');
  let availability = $state<'drop' | 'shop' | 'both'>('drop');
  let progress = $state('');
  let uploadError = $state('');

  async function upload(e: SubmitEvent) {
    e.preventDefault();
    if (!files || files.length === 0) return void (uploadError = 'Wybierz obrazki.');
    if (!album.trim()) return void (uploadError = 'Wpisz nazwę albumu.');
    uploadError = '';
    const list = [...files];
    let done = 0;
    for (const f of list) {
      progress = `Wysyłanie ${done + 1} z ${list.length}…`;
      const name = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 60) || 'Naklejka';
      const qs = new URLSearchParams({ name, album: album.trim(), rarity, kind, availability });
      try {
        await request('POST', `/v1/packs/${page.params.id}/items?${qs}`, { raw: f, contentType: f.type });
        done++;
      } catch (err) {
        uploadError = `${f.name}: ${errorMessage(err)}`;
      }
    }
    progress = `Dodano ${done} z ${list.length}.`;
    await load();
  }

  // Item editor
  let editOpen = $state(false);
  let editing = $state<ItemDto | null>(null);
  let eName = $state('');
  let eAlbum = $state('');
  let eRarity = $state<Rarity>('common');
  let eAvail = $state<'drop' | 'shop' | 'both'>('drop');
  function openItem(i: ItemDto) {
    if (pack?.builtIn) return;
    editing = i;
    eName = i.name;
    eAlbum = i.album;
    eRarity = i.rarity;
    eAvail = i.price === null ? 'drop' : i.droppable ? 'both' : 'shop';
    editOpen = true;
  }
  async function saveItem() {
    if (!editing) return;
    try {
      await api.patch(`/v1/items/${editing.id}`, {
        name: eName.trim(),
        album: eAlbum.trim(),
        rarity: eRarity,
        price: eAvail === 'drop' ? null : 0,
        droppable: editing.kind === 'sticker' && eAvail !== 'shop',
      });
      editOpen = false;
      await load();
    } catch (e) {
      error = errorMessage(e);
    }
  }
  async function deleteItem() {
    if (!editing) return;
    await api.del(`/v1/items/${editing.id}`);
    editOpen = false;
    await load();
  }
</script>

<main class="screen">
  <BackHeader title={pack?.name ?? 'Paczka'} back="/parent/rewards" />
  {#if error}<div class="error-box">{error}</div>{/if}
  {#if pack}
    <p class="muted small">
      Licencja: {pack.license === 'private' ? 'prywatna' : pack.license} · źródło: {pack.source}{pack.attribution ? ` · ${pack.attribution}` : ''}
      {pack.builtIn ? ' · paczka wbudowana (można ją tylko włączyć lub wyłączyć)' : ''}
    </p>

    {#if !pack.builtIn && CUSTOM_PACKS_ENABLED}
      <form class="card stack" onsubmit={upload}>
        <h2>Dodaj obrazki</h2>
        <input type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml" multiple onchange={(e) => (files = e.currentTarget.files)} />
        <label class="field">
          <span>Album</span>
          <input type="text" bind:value={album} list="albums" maxlength="60" placeholder="np. Domowe zwierzaki" />
          <datalist id="albums">{#each albums as a (a)}<option value={a}></option>{/each}</datalist>
        </label>
        <div class="field">
          <span>Rodzaj</span>
          <select bind:value={kind}>
            <option value="sticker">Naklejki</option>
            <option value="avatar">Awatary</option>
            <option value="frame">Ramki</option>
          </select>
        </div>
        <div class="field">
          <span>Rzadkość</span>
          <div class="segmented">
            {#each ['common', 'rare', 'legendary'] as const as r (r)}
              <button type="button" aria-pressed={rarity === r} onclick={() => (rarity = r)}>{RARITY_LABEL[r]}</button>
            {/each}
          </div>
        </div>
        {#if kind === 'sticker'}
          <div class="field">
            <span>Skąd można je dostać</span>
            <select bind:value={availability}>
              <option value="drop">Tylko z losowania</option>
              <option value="shop">Tylko ze sklepu</option>
              <option value="both">Losowanie i sklep</option>
            </select>
          </div>
        {/if}
        <p class="hint muted small">Obrazki do 512 KB: PNG, WebP, JPG lub SVG. Nazwa pliku stanie się nazwą naklejki.</p>
        {#if uploadError}<div class="error-box">{uploadError}</div>{/if}
        {#if progress}<p class="small">{progress}</p>{/if}
        <button class="btn primary">Wyślij</button>
      </form>
    {/if}

    {#each albums as a (a)}
      <section class="section">
        <h2 class="section-title">{a}</h2>
        <div class="grid">
          {#each items.filter((i) => i.album === a) as i (i.id)}
            <button class="cell" onclick={() => openItem(i)} disabled={pack.builtIn}>
              <ItemImage url={i.imageUrl} name={i.name} rarity={i.rarity} size={64} />
              <span class="name">{i.name}</span>
              <span class="meta">{KIND_LABEL[i.kind]} · {i.price === null ? 'losowanie' : `${i.price} pkt`}</span>
            </button>
          {/each}
        </div>
      </section>
    {:else}
      <p class="empty">Ta paczka jest pusta.</p>
    {/each}
  {/if}
</main>

<Sheet bind:open={editOpen} title="Edytuj">
  {#if editing}
    <ItemImage url={editing.imageUrl} name={editing.name} rarity={eRarity} size={96} />
    <label class="field"><span>Nazwa</span><input type="text" bind:value={eName} maxlength="60" /></label>
    <label class="field"><span>Album</span><input type="text" bind:value={eAlbum} maxlength="60" /></label>
    <div class="segmented">
      {#each ['common', 'rare', 'legendary'] as const as r (r)}
        <button type="button" aria-pressed={eRarity === r} onclick={() => (eRarity = r)}>{RARITY_LABEL[r]}</button>
      {/each}
    </div>
    {#if editing.kind === 'sticker'}
      <select bind:value={eAvail}>
        <option value="drop">Tylko z losowania</option>
        <option value="shop">Tylko ze sklepu</option>
        <option value="both">Losowanie i sklep</option>
      </select>
    {/if}
    <button class="btn primary block" onclick={saveItem}>Zapisz</button>
    <button class="btn ghost block danger-text" onclick={deleteItem}>Usuń z paczki</button>
  {/if}
</Sheet>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
  }
  .cell {
    appearance: none;
    border: 0;
    background: var(--surface);
    border-radius: 12px;
    padding: 6px 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .cell:disabled {
    cursor: default;
  }
  .name {
    font-size: 0.7rem;
    text-align: center;
  }
  .meta {
    font-size: 0.6rem;
    color: var(--muted);
  }
  .danger-text {
    color: var(--danger);
  }
</style>
