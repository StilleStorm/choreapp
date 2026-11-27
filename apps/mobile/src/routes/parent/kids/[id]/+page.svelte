<script lang="ts">
  import { BONUS_MAX, BONUS_REASON_MAX, type BonusResultDto, type HistoryEntryDto, type PointsDto, type StatsDto } from '@choreapp/shared';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import TaskIcon from '#lib/components/TaskIcon.svelte';
  import { dateTime, dayMonth } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  const child = $derived(session.member(page.params.id!));
  let stats = $state<StatsDto | null>(null);
  let points = $state<PointsDto | null>(null);
  let error = $state('');
  let tab = $state<'tasks' | 'points'>('tasks');

  function load(id: string) {
    return Promise.all([api.get<StatsDto>(`/v1/members/${id}/stats`), api.get<PointsDto>(`/v1/members/${id}/points`)])
      .then(([s, p]) => {
        stats = s;
        points = p;
      })
      .catch((e) => (error = errorMessage(e)));
  }

  $effect(() => {
    void load(page.params.id!);
  });

  // "Daj punkty": only adding. Form first, then a summary to confirm.
  const QUICK = [5, 10, 20, 50];
  let bonusOpen = $state(false);
  let bonusStep = $state<'form' | 'confirm'>('form');
  let bonusAmount = $state<number | null>(null);
  let bonusReason = $state('');
  let bonusError = $state('');
  let bonusBusy = $state(false);
  let bonusOpId = '';
  let toast = $state('');

  const amountOk = $derived(Number.isInteger(bonusAmount) && bonusAmount! >= 1 && bonusAmount! <= BONUS_MAX);
  const reasonOk = $derived(bonusReason.trim().length > 0 && bonusReason.trim().length <= BONUS_REASON_MAX);

  function openBonus() {
    bonusStep = 'form';
    bonusAmount = null;
    bonusReason = '';
    bonusError = '';
    bonusOpen = true;
  }

  function toConfirm(e: SubmitEvent) {
    e.preventDefault();
    if (!amountOk) return void (bonusError = `Wpisz liczbę punktów od 1 do ${BONUS_MAX}.`);
    if (!reasonOk) return void (bonusError = 'Wpisz, za co są punkty.');
    bonusError = '';
    bonusOpId = crypto.randomUUID();
    bonusStep = 'confirm';
  }

  async function giveBonus() {
    if (bonusBusy || !child) return;
    bonusBusy = true;
    try {
      await api.post<BonusResultDto>(`/v1/members/${child.id}/bonus`, {
        amount: bonusAmount,
        reason: bonusReason.trim(),
        clientOpId: bonusOpId,
      });
      bonusOpen = false;
      toast = `${child.name}: +${bonusAmount} pkt`;
      setTimeout(() => (toast = ''), 3000);
      tab = 'points';
      await load(child.id);
    } catch (e) {
      bonusError = errorMessage(e);
    } finally {
      bonusBusy = false;
    }
  }

  const STATUS: Record<HistoryEntryDto['status'], [string, string]> = {
    approved: ['Zrobione', 'success'],
    reported: ['Do sprawdzenia', 'warning'],
    rejected: ['Odrzucone', 'danger'],
    missed: ['Niezrobione', 'danger'],
    closed: ['Zrobione przez rodzeństwo', ''],
  };

  const byDay = $derived.by(() => {
    const groups: { date: string; items: HistoryEntryDto[] }[] = [];
    for (const h of stats?.history ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.date === h.date) last.items.push(h);
      else groups.push({ date: h.date, items: [h] });
    }
    return groups;
  });
</script>

<main class="screen">
  <BackHeader title={child?.name ?? 'Dziecko'} back="/parent/kids" />
  {#if error}<div class="error-box">{error}</div>{/if}

  {#if stats && child}
    <section class="card head">
      <Avatar name={child.name} url={child.avatarUrl} frameUrl={child.frameUrl} size={72} />
      <div class="grid">
        <div><span class="num">{stats.balance}</span><span class="muted small">saldo</span></div>
        <div><span class="num">{stats.earnedTotal}</span><span class="muted small">zdobyte łącznie</span></div>
        <div><span class="num">{stats.streak.current}</span><span class="muted small">seria (dni)</span></div>
        <div><span class="num">{stats.streak.longest}</span><span class="muted small">najdłuższa</span></div>
        <div>
          <span class="num">{stats.onTimeRate30 === null ? '–' : `${Math.round(stats.onTimeRate30 * 100)}%`}</span>
          <span class="muted small">w terminie (30 dni)</span>
        </div>
        <div><span class="num">{stats.stickersOwned}/{stats.stickersTotal}</span><span class="muted small">naklejki</span></div>
      </div>
    </section>

    <button class="btn primary block" onclick={openBonus}><Icon name="plus" size={20} /> Daj punkty</button>

    <div class="segmented" role="tablist">
      <button aria-pressed={tab === 'tasks'} onclick={() => (tab = 'tasks')}>Zadania (30 dni)</button>
      <button aria-pressed={tab === 'points'} onclick={() => (tab = 'points')}>Punkty</button>
    </div>

    {#if tab === 'tasks'}
      {#each byDay as g (g.date)}
        <section class="section">
          <h2 class="section-title">{dayMonth(g.date)}</h2>
          <div class="list">
            {#each g.items as h, i (i)}
              <div class="row">
                <TaskIcon icon={h.icon} size={32} />
                <span class="grow">
                  <span class="title">{h.title}</span>
                  {#if h.late}<span class="meta">zgłoszone po terminie</span>{/if}
                </span>
                {#if h.points > 0}<span class="muted small">+{h.points}</span>{/if}
                <span class="badge {STATUS[h.status][1]}">{STATUS[h.status][0]}</span>
              </div>
            {/each}
          </div>
        </section>
      {:else}
        <p class="empty">Brak historii z ostatnich 30 dni.</p>
      {/each}
    {:else if points}
      <div class="list">
        {#each points.ledger as e (e.id)}
          <div class="row">
            <span class="grow">
              <span class="title">{e.label}</span>
              <span class="meta">{dateTime(e.createdAt, session.family!.timezone)}</span>
            </span>
            <strong class:neg={e.amount < 0} class="amount">{e.amount > 0 ? '+' : ''}{e.amount}</strong>
          </div>
        {:else}
          <p class="empty">Brak wpisów.</p>
        {/each}
      </div>
    {/if}
  {:else if !error}
    <p class="empty">Wczytywanie…</p>
  {/if}
</main>

<Sheet bind:open={bonusOpen} title="Daj punkty">
  {#if bonusStep === 'form'}
    <form class="stack" onsubmit={toConfirm}>
      <div class="field">
        <span>Ile punktów?</span>
        <div class="chips">
          {#each QUICK as q (q)}
            <button type="button" class="chip" aria-pressed={bonusAmount === q} onclick={() => (bonusAmount = q)}>+{q}</button>
          {/each}
        </div>
        <input type="number" inputmode="numeric" min="1" max={BONUS_MAX} step="1" bind:value={bonusAmount} placeholder="albo wpisz liczbę" />
        <span class="hint">Od 1 do {BONUS_MAX}. Punkty można tylko dodać.</span>
      </div>
      <label class="field">
        <span>Za co?</span>
        <input type="text" bind:value={bonusReason} maxlength={BONUS_REASON_MAX} required placeholder="np. pomoc babci" />
        <span class="hint">{child?.name ?? 'Dziecko'} zobaczy to w historii punktów.</span>
      </label>
      {#if bonusError}<div class="error-box">{bonusError}</div>{/if}
      <button class="btn primary block">Dalej</button>
    </form>
  {:else}
    <div class="stack">
      <div class="card summary">
        <p class="big"><strong>{child?.name}</strong> dostanie <strong class="plus">+{bonusAmount} pkt</strong></p>
        <p>za: {bonusReason.trim()}</p>
      </div>
      {#if bonusError}<div class="error-box">{bonusError}</div>{/if}
      <button class="btn success block" disabled={bonusBusy} onclick={giveBonus}>Tak, daj +{bonusAmount} pkt</button>
      <button class="btn ghost block" disabled={bonusBusy} onclick={() => (bonusStep = 'form')}>Wróć i popraw</button>
    </div>
  {/if}
</Sheet>

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
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
  .summary {
    text-align: center;
  }
  .summary .big {
    font-size: 1.15rem;
  }
  .plus {
    color: var(--success);
  }
  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .grid {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px 6px;
    text-align: center;
  }
  .grid > div {
    display: flex;
    flex-direction: column;
  }
  .num {
    font-size: 1.3rem;
    font-weight: 800;
  }
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .amount {
    color: var(--success);
  }
  .amount.neg {
    color: var(--danger);
  }
</style>
