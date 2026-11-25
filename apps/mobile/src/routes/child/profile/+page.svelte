<script lang="ts">
  import type { CollectionDto, ItemDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import AvatarPicker from '#lib/components/AvatarPicker.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import ItemImage from '#lib/components/ItemImage.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  const me = $derived(session.me!);
  let collection = $state<CollectionDto | null>(null);
  let error = $state('');

  async function load() {
    try {
      collection = await api.get<CollectionDto>('/v1/members/me/collection');
    } catch (e) {
      error = errorMessage(e);
    }
  }
  $effect(() => {
    void load();
  });

  const totals = $derived(
    (collection?.albums ?? []).reduce((acc, a) => ({ owned: acc.owned + a.owned, total: acc.total + a.total }), { owned: 0, total: 0 }),
  );
  const ownedAvatars = $derived((collection?.avatars ?? []).filter((a) => a.owned));
  const ownedFrames = $derived((collection?.frames ?? []).filter((f) => f.owned));

  // Name + photo
  let editOpen = $state(false);
  let name = $state('');
  let blob = $state<Blob | null>(null);
  let busy = $state(false);
  let editError = $state('');
  function openEdit() {
    name = me.name;
    blob = null;
    editError = '';
    editOpen = true;
  }
  async function saveEdit() {
    busy = true;
    editError = '';
    try {
      if (name.trim() && name.trim() !== me.name) await api.patch('/v1/me', { name: name.trim() });
      if (blob) await api.upload('/v1/me/avatar', blob);
      await session.refresh();
      editOpen = false;
    } catch (e) {
      editError = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  // Avatar item / frame
  let lookOpen = $state(false);
  async function wear(avatarItemId: string | null, frameItemId: string | null) {
    try {
      await api.put('/v1/me/appearance', { avatarItemId, frameItemId });
      await session.refresh();
    } catch (e) {
      error = errorMessage(e);
    }
  }
  function isWorn(i: ItemDto): boolean {
    return i.kind === 'avatar' ? me.avatarItemId === i.id : me.frameItemId === i.id;
  }
</script>

<main class="screen">
  <section class="profile-head">
    <button class="avatar-btn" onclick={() => (lookOpen = true)} aria-label="Zmień wygląd">
      <Avatar name={me.name} url={me.avatarUrl} frameUrl={me.frameUrl} size={112} />
    </button>
    <h1>{me.name}</h1>
    <div class="inline">
      <button class="btn small" onclick={openEdit}><Icon name="edit" size={18} /> Nazwa i zdjęcie</button>
      <button class="btn small" onclick={() => (lookOpen = true)}><Icon name="user" size={18} /> Awatar i ramka</button>
    </div>
    <a class="btn small ghost" href="/child/themes"><Icon name="palette" size={18} /> Wygląd aplikacji</a>
  </section>

  {#if error}<div class="error-box">{error}</div>{/if}

  <section class="section">
    <div class="inline">
      <h2 class="section-title grow">Moja kolekcja</h2>
      {#if collection}<span class="badge accent">{totals.owned} z {totals.total}</span>{/if}
    </div>
    {#if collection}
      <div class="albums">
        {#each collection.albums as a (a.name)}
          {@const preview = a.items.filter((i) => i.owned).slice(0, 3)}
          <a class="card album" href="/child/album/{encodeURIComponent(a.name)}">
            <div class="thumbs">
              {#each preview as i (i.id)}<img src={i.imageUrl} alt="" />{:else}<span class="muted">?</span>{/each}
            </div>
            <span class="album-name">{a.name}</span>
            <span class="muted small">{a.owned} z {a.total}</span>
            <span class="bar"><span style:width="{a.total ? (a.owned / a.total) * 100 : 0}%"></span></span>
            {#if a.items.some((i) => i.isNew)}<span class="badge danger new">Nowe!</span>{/if}
          </a>
        {/each}
      </div>
    {:else if !error}
      <p class="empty">Wczytywanie…</p>
    {/if}
  </section>

  <a class="btn ghost small" href="/licenses">Licencje grafik</a>
</main>

<Sheet bind:open={editOpen} title="Nazwa i zdjęcie">
  <AvatarPicker name={name || me.name} currentUrl={me.avatarItemId ? null : me.avatarUrl} bind:blob />
  <label class="field">
    <span>Twoja nazwa</span>
    <input type="text" bind:value={name} maxlength="40" autocomplete="off" />
    <span class="hint muted small">Może być pseudonim. Nie wpisuj nazwiska.</span>
  </label>
  {#if editError}<div class="error-box">{editError}</div>{/if}
  <button class="btn primary block" onclick={saveEdit} disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz'}</button>
</Sheet>

<Sheet bind:open={lookOpen} title="Awatar i ramka">
  <h3 class="section-title">Awatar</h3>
  <div class="pick-grid">
    <button class="pick" aria-pressed={!me.avatarItemId} onclick={() => wear(null, me.frameItemId)}>
      <Avatar name={me.name} url={me.avatarItemId ? null : me.avatarUrl} size={64} />
      <span>Moje zdjęcie</span>
    </button>
    {#each ownedAvatars as a (a.id)}
      <button class="pick" aria-pressed={isWorn(a)} onclick={() => wear(a.id, me.frameItemId)}>
        <img src={a.imageUrl} alt="" width="64" height="64" />
        <span>{a.name}</span>
      </button>
    {/each}
  </div>
  {#if ownedAvatars.length === 0}<p class="muted small">Więcej awatarów kupisz w Sklepie.</p>{/if}

  <h3 class="section-title">Ramka</h3>
  <div class="pick-grid">
    <button class="pick" aria-pressed={!me.frameItemId} onclick={() => wear(me.avatarItemId, null)}>
      <span class="no-frame">bez ramki</span>
    </button>
    {#each ownedFrames as f (f.id)}
      <button class="pick" aria-pressed={isWorn(f)} onclick={() => wear(me.avatarItemId, f.id)}>
        <ItemImage url={f.imageUrl} name={f.name} rarity={f.rarity} size={64} />
        <span>{f.name.replace('Ramka: ', '')}</span>
      </button>
    {/each}
  </div>
  {#if ownedFrames.length === 0}<p class="muted small">Ramki kupisz w Sklepie.</p>{/if}
</Sheet>

<style>
  .profile-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding-top: 8px;
  }
  .avatar-btn {
    appearance: none;
    border: 0;
    background: none;
    padding: 16px;
    cursor: pointer;
  }
  .grow {
    flex: 1;
  }
  .albums {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .album {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: inherit;
    text-decoration: none;
  }
  .thumbs {
    display: flex;
    gap: 4px;
    height: 44px;
    align-items: center;
  }
  .thumbs img {
    width: 40px;
    height: 40px;
  }
  .album-name {
    font-weight: 800;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--progress, var(--accent));
  }
  .new {
    position: absolute;
    top: 8px;
    right: 8px;
  }
  .pick-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 8px;
  }
  .pick {
    appearance: none;
    border: 2px solid transparent;
    background: var(--surface-2);
    border-radius: 14px;
    padding: 8px 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font: inherit;
    font-size: 0.7rem;
    color: var(--text);
    cursor: pointer;
  }
  .pick[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .pick img {
    border-radius: 50%;
  }
  .no-frame {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 2px dashed var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    color: var(--muted);
  }
</style>
