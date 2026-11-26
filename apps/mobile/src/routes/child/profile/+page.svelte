<script lang="ts">
  import type { CollectionDto, ItemDto } from '@choreapp/shared';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { Home } from '#lib/homes.js';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import ItemImage from '#lib/components/ItemImage.svelte';
  import ParentReturn from '#lib/components/ParentReturn.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import ThemeAvatarGrid from '#lib/components/ThemeAvatarGrid.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  const me = $derived(session.me!);
  let collection = $state<CollectionDto | null>(null);
  /** Free avatars of every app theme (the child's own theme is shown first). */
  let themeAvatars = $state<ItemDto[]>([]);
  let error = $state('');

  async function load() {
    try {
      [collection, themeAvatars] = await Promise.all([
        api.get<CollectionDto>('/v1/members/me/collection'),
        api.get<ItemDto[]>('/v1/avatars/themes'),
      ]);
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

  // Name (children have avatars only, no photos: Google Play Families policy)
  let editOpen = $state(false);
  let name = $state('');
  let busy = $state(false);
  let editError = $state('');
  function openEdit() {
    name = me.name;
    editError = '';
    editOpen = true;
  }
  async function saveEdit() {
    busy = true;
    editError = '';
    try {
      if (name.trim() && name.trim() !== me.name) await api.patch('/v1/me', { name: name.trim() });
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
  // Homes ("domy"): a phone can belong to mum's home, dad's home, grandparents'…
  let homeError = $state('');
  let switching = $state('');
  let leaving = $state<Home | null>(null);
  let leaveOpen = $state(false);
  // Once per visit. Never from an $effect: it reads `homes` and may save it.
  onMount(() => {
    void session.checkHomes();
  });
  async function switchTo(h: Home) {
    homeError = '';
    switching = h.token;
    try {
      await session.switchTo(h.token);
      await goto('/child/today', { replace: true });
    } catch (e) {
      homeError = errorMessage(e);
    } finally {
      switching = '';
    }
  }
  function askLeave(h: Home) {
    leaving = h;
    leaveOpen = true;
  }
  async function leave() {
    const h = leaving;
    leaveOpen = false;
    if (h) await session.leaveHome(h.token);
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
      <button class="btn small" onclick={openEdit}><Icon name="edit" size={18} /> Nazwa</button>
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

  {#if session.swapped}
    <!-- A parent's phone lent to this child: no other homes here, only the way back. -->
    <section class="section swap-back">
      <ParentReturn />
    </section>
  {:else}
  <section class="section">
    <h2 class="section-title">Domy</h2>
    <div class="card homes">
      {#each session.homes.list as h (h.token)}
        {@const active = h.token === session.homes.active}
        <div class="home-row">
          <button class="home-pick" aria-current={active} disabled={active || !!switching} onclick={() => switchTo(h)}>
            <Icon name="home" size={22} />
            <span class="home-text">
              <strong>{h.familyName || session.family?.name}</strong>
              <span class="muted small">
                {active ? 'Teraz tutaj' : switching === h.token ? 'Przełączanie…' : 'Dotknij, aby przełączyć'} · {h.memberName || me.name}
              </span>
            </span>
            {#if active}<Icon name="check" size={20} />{/if}
          </button>
          <button class="icon-btn" aria-label="Usuń ten dom z telefonu" onclick={() => askLeave(h)}><Icon name="trash" size={20} /></button>
        </div>
      {/each}
    </div>
    {#if homeError}<div class="error-box">{homeError}</div>{/if}
    <a class="btn block" href="/join?add=1"><Icon name="plus" size={18} /> Dodaj kolejny dom</a>
    <p class="muted small">Np. dom taty albo dziadków. Poproś dorosłego z tamtego domu o kod QR albo 6 cyfr.</p>
  </section>
  {/if}

  <a class="btn ghost small" href="/about">O aplikacji</a>
</main>

<Sheet bind:open={editOpen} title="Nazwa">
  <label class="field">
    <span>Twoja nazwa</span>
    <input type="text" bind:value={name} maxlength="40" autocomplete="off" />
    <span class="hint muted small">Może być pseudonim. Nie wpisuj nazwiska.</span>
  </label>
  {#if editError}<div class="error-box">{editError}</div>{/if}
  <button class="btn primary block" onclick={saveEdit} disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz'}</button>
</Sheet>

<Sheet bind:open={leaveOpen} title="Usuń ten dom z telefonu">
  {#if leaving}
    <p>Ten telefon przestanie pokazywać dom <strong>{leaving.familyName || session.family?.name}</strong>.</p>
    <p class="muted small">Punkty i naklejki w tym domu zostają. Aby wrócić, potrzebny będzie nowy kod od dorosłego z tego domu.</p>
    <div class="inline">
      <button class="btn grow" onclick={() => (leaveOpen = false)}>Anuluj</button>
      <button class="btn danger grow" onclick={leave}>Usuń</button>
    </div>
  {/if}
</Sheet>

<Sheet bind:open={lookOpen} title="Awatar i ramka">
  <ThemeAvatarGrid avatars={themeAvatars} theme={me.theme} selectedId={me.avatarItemId} onpick={(a) => wear(a.id, me.frameItemId)}>
    <h3 class="section-title">Moje awatary</h3>
    <div class="pick-grid">
      <button class="pick" aria-pressed={!me.avatarItemId} onclick={() => wear(null, me.frameItemId)}>
        <Avatar name={me.name} size={64} />
        <span>Domyślny</span>
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
  </ThemeAvatarGrid>
</Sheet>

<style>
  .swap-back {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
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
  .homes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
  }
  .home-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .home-pick {
    appearance: none;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 8px 10px;
    border: 2px solid transparent;
    border-radius: 14px;
    background: none;
    font: inherit;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .home-pick[aria-current='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
    cursor: default;
  }
  .home-pick:disabled:not([aria-current='true']) {
    opacity: 0.6;
  }
  .home-text {
    flex: 1;
    display: flex;
    flex-direction: column;
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
