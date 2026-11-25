<script lang="ts">
  import type { FamilyDto, PackDto, RedemptionDto, RewardDto } from '@choreapp/shared';
  import { goto } from '$app/navigation';
  import { api } from '#lib/api.js';
  import { pendingCounts } from '#lib/badges.svelte.js';
  import Icon from '#lib/components/Icon.svelte';
  import IconPicker from '#lib/components/IconPicker.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import TaskIcon from '#lib/components/TaskIcon.svelte';
  import { dateTime } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';
  import { DEFAULT_REWARD_ICON } from '#lib/taskIcons.js';

  let rewards = $state<RewardDto[]>([]);
  let redemptions = $state<RedemptionDto[]>([]);
  let packs = $state<PackDto[]>([]);
  let error = $state('');
  let toast = $state('');

  async function load() {
    try {
      [rewards, redemptions, packs] = await Promise.all([
        api.get<RewardDto[]>('/v1/rewards'),
        api.get<RedemptionDto[]>('/v1/redemptions'),
        api.get<PackDto[]>('/v1/packs'),
      ]);
      pendingCounts.redemptions = redemptions.filter((r) => r.status === 'requested').length;
    } catch (e) {
      error = errorMessage(e);
    }
  }
  $effect(() => {
    void load();
  });

  function flash(msg: string) {
    toast = msg;
    setTimeout(() => (toast = ''), 2500);
  }

  const pending = $derived(redemptions.filter((r) => r.status === 'requested'));
  const recent = $derived(redemptions.filter((r) => r.status !== 'requested').slice(0, 10));

  async function resolve(r: RedemptionDto, action: 'deliver' | 'cancel') {
    try {
      await api.post(`/v1/redemptions/${r.id}/${action}`);
      flash(action === 'deliver' ? 'Oznaczone jako wydane.' : `Anulowane, ${r.memberName} dostaje ${r.cost} pkt z powrotem.`);
      await load();
    } catch (e) {
      flash(errorMessage(e));
    }
  }

  // Reward editor
  let rewardOpen = $state(false);
  let editing = $state<RewardDto | null>(null);
  let rName = $state('');
  let rIcon = $state(DEFAULT_REWARD_ICON);
  let rCost = $state(100);
  let rActive = $state(true);
  let rError = $state('');
  function openReward(r: RewardDto | null) {
    editing = r;
    rName = r?.name ?? '';
    rIcon = r?.icon ?? DEFAULT_REWARD_ICON;
    rCost = r?.cost ?? 100;
    rActive = r?.active ?? true;
    rError = '';
    rewardOpen = true;
  }
  async function saveReward(e: SubmitEvent) {
    e.preventDefault();
    rError = '';
    const json = { name: rName.trim(), icon: rIcon, cost: Number(rCost), active: rActive };
    try {
      if (editing) await api.patch(`/v1/rewards/${editing.id}`, json);
      else await api.post('/v1/rewards', json);
      rewardOpen = false;
      await load();
    } catch (err) {
      rError = errorMessage(err);
    }
  }
  async function deleteReward() {
    if (!editing) return;
    await api.del(`/v1/rewards/${editing.id}`);
    rewardOpen = false;
    await load();
  }

  // Prices
  const prices = session.family!.prices;
  let pCommon = $state(prices.common);
  let pRare = $state(prices.rare);
  let pLegendary = $state(prices.legendary);
  async function savePrices(e: SubmitEvent) {
    e.preventDefault();
    try {
      await api.patch<FamilyDto>('/v1/family', { priceCommon: Number(pCommon), priceRare: Number(pRare), priceLegendary: Number(pLegendary) });
      await session.refresh();
      flash('Ceny zapisane.');
    } catch (err) {
      flash(errorMessage(err));
    }
  }

  // Packs
  async function togglePack(p: PackDto) {
    try {
      await api.patch(`/v1/packs/${p.id}`, { active: !p.active });
      await load();
    } catch (e) {
      flash(errorMessage(e));
    }
  }
  let packOpen = $state(false);
  let pkName = $state('');
  let pkLicense = $state('private');
  let pkSource = $state('');
  let pkAttribution = $state('');
  let pkError = $state('');
  async function createPack(e: SubmitEvent) {
    e.preventDefault();
    pkError = '';
    try {
      const r = await api.post<{ id: string }>('/v1/packs', {
        name: pkName.trim(),
        license: pkLicense,
        source: pkSource.trim() || (pkLicense === 'private' ? 'własne' : '—'),
        attribution: pkAttribution.trim() || null,
      });
      packOpen = false;
      await goto(`/parent/packs/${r.id}`);
    } catch (err) {
      pkError = errorMessage(err);
    }
  }
</script>

<main class="screen">
  <header class="screen-header"><h1>Nagrody</h1></header>
  {#if error}<div class="error-box">{error}</div>{/if}

  <section class="section">
    <h2 class="section-title">Do wydania {pending.length ? `(${pending.length})` : ''}</h2>
    {#each pending as r (r.id)}
      <article class="card redemption">
        <div class="inline">
          <TaskIcon icon={r.rewardIcon} size={40} />
          <div class="grow">
            <strong>{r.rewardName}</strong>
            <p class="muted small">{r.memberName} · {r.cost} pkt · {dateTime(r.createdAt, session.family!.timezone)}</p>
          </div>
        </div>
        <div class="actions">
          <button class="btn danger" onclick={() => resolve(r, 'cancel')}>Anuluj i zwróć</button>
          <button class="btn success" onclick={() => resolve(r, 'deliver')}><Icon name="check" size={20} /> Wydane</button>
        </div>
      </article>
    {:else}
      <p class="card muted small">Nikt nie czeka na nagrodę.</p>
    {/each}
  </section>

  <section class="section">
    <div class="inline">
      <h2 class="section-title grow">Nagrody od Was</h2>
      <button class="btn small primary" onclick={() => openReward(null)}><Icon name="plus" size={18} /> Dodaj</button>
    </div>
    <div class="list">
      {#each rewards as r (r.id)}
        <button class="row plain" onclick={() => openReward(r)}>
          <TaskIcon icon={r.icon} size={36} />
          <span class="grow title">{r.name}</span>
          {#if !r.active}<span class="badge">ukryta</span>{/if}
          <span class="badge accent">{r.cost} pkt</span>
        </button>
      {:else}
        <p class="empty small">Półka z nagrodami jest u dzieci ukryta, dopóki nie dodasz pierwszej nagrody.</p>
      {/each}
    </div>
  </section>

  {#if recent.length > 0}
    <section class="section">
      <h2 class="section-title">Ostatnio</h2>
      <div class="list">
        {#each recent as r (r.id)}
          <div class="row">
            <TaskIcon icon={r.rewardIcon} size={28} />
            <span class="grow small">{r.memberName}: {r.rewardName}</span>
            <span class="badge {r.status === 'delivered' ? 'success' : ''}">{r.status === 'delivered' ? 'wydana' : 'anulowana'}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <form class="section" onsubmit={savePrices}>
    <h2 class="section-title">Ceny w sklepie (naklejki, awatary, ramki)</h2>
    <div class="card prices">
      <label class="field"><span>Zwykła</span><input type="number" min="1" bind:value={pCommon} /></label>
      <label class="field"><span>Rzadka</span><input type="number" min="1" bind:value={pRare} /></label>
      <label class="field"><span>Legendarna</span><input type="number" min="1" bind:value={pLegendary} /></label>
      <button class="btn primary">Zapisz ceny</button>
    </div>
  </form>

  <section class="section">
    <div class="inline">
      <h2 class="section-title grow">Paczki naklejek</h2>
      <button class="btn small" onclick={() => (packOpen = true)}><Icon name="plus" size={18} /> Własna paczka</button>
    </div>
    <div class="list">
      {#each packs as p (p.id)}
        <div class="row">
          <a class="grow pack-link" href="/parent/packs/{p.id}">
            <span class="title">{p.name}</span>
            <span class="meta">{p.itemCount} szt. · {p.license === 'private' ? 'prywatna' : p.license}{p.builtIn ? ' · wbudowana' : ''}</span>
          </a>
          <label class="switch" aria-label="Włączona">
            <input type="checkbox" checked={p.active} onchange={() => togglePack(p)} />
            <span></span>
          </label>
        </div>
      {/each}
    </div>
    <a class="btn ghost small" href="/licenses">Licencje grafik</a>
  </section>
</main>

<Sheet bind:open={rewardOpen} title={editing ? 'Edytuj nagrodę' : 'Nowa nagroda'}>
  <form class="stack" onsubmit={saveReward}>
    <label class="field">
      <span>Nazwa</span>
      <input type="text" bind:value={rName} maxlength="60" required placeholder="np. Godzina na konsoli" />
    </label>
    <IconPicker bind:value={rIcon} />
    <label class="field">
      <span>Koszt w punktach</span>
      <input type="number" min="1" max="100000" bind:value={rCost} required />
      <span class="hint">Dzień zadań to zwykle około 30 punktów.</span>
    </label>
    <label class="inline"><input type="checkbox" bind:checked={rActive} /> <span>Widoczna w sklepie</span></label>
    {#if rError}<div class="error-box">{rError}</div>{/if}
    <button class="btn primary block">Zapisz</button>
    {#if editing}<button type="button" class="btn ghost block danger-text" onclick={deleteReward}>Usuń nagrodę</button>{/if}
  </form>
</Sheet>

<Sheet bind:open={packOpen} title="Własna paczka">
  <form class="stack" onsubmit={createPack}>
    <label class="field"><span>Nazwa</span><input type="text" bind:value={pkName} maxlength="60" required placeholder="np. Rysunki Oli" /></label>
    <label class="field">
      <span>Licencja</span>
      <select bind:value={pkLicense}>
        <option value="private">Prywatna (własne rysunki, zdjęcia)</option>
        <option value="CC0-1.0">CC0 (domena publiczna)</option>
        <option value="CC-BY-4.0">CC BY 4.0 (wymaga podpisu autora)</option>
        <option value="MIT">MIT</option>
        <option value="other">Inna</option>
      </select>
    </label>
    {#if pkLicense !== 'private'}
      <label class="field"><span>Źródło (link)</span><input type="text" bind:value={pkSource} maxlength="300" required /></label>
      <label class="field"><span>Podpis autora</span><input type="text" bind:value={pkAttribution} maxlength="500" /></label>
    {/if}
    {#if pkError}<div class="error-box">{pkError}</div>{/if}
    <button class="btn primary block">Utwórz i dodaj obrazki</button>
  </form>
</Sheet>

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
  .grow {
    flex: 1;
    min-width: 0;
  }
  .redemption {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .actions .btn {
    white-space: nowrap;
    padding: 0 8px;
  }
  .plain {
    appearance: none;
    border: 0;
    background: none;
    width: 100%;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .prices {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    align-items: end;
  }
  .prices .btn {
    grid-column: 1 / -1;
  }
  .pack-link {
    display: flex;
    flex-direction: column;
    color: inherit;
    text-decoration: none;
  }
  .switch {
    position: relative;
    width: 48px;
    height: 28px;
    flex: none;
  }
  .switch input {
    opacity: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    position: absolute;
    cursor: pointer;
    z-index: 1;
  }
  .switch span {
    position: absolute;
    inset: 0;
    border-radius: 14px;
    background: var(--border);
    transition: background 0.15s;
  }
  .switch span::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .switch input:checked + span {
    background: var(--success);
  }
  .switch input:checked + span::after {
    transform: translateX(20px);
  }
  .danger-text {
    color: var(--danger);
  }
  .toast {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 12px);
    z-index: 30;
    background: #20242b;
    color: #fff;
    border-radius: 14px;
    padding: 12px 16px;
    text-align: center;
    font-weight: 600;
  }
</style>
