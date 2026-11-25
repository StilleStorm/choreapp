<script lang="ts">
  import type { HistoryEntryDto, PointsDto, StatsDto } from '@choreapp/shared';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import TaskIcon from '#lib/components/TaskIcon.svelte';
  import { dateTime, dayMonth } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  const child = $derived(session.member(page.params.id!));
  let stats = $state<StatsDto | null>(null);
  let points = $state<PointsDto | null>(null);
  let error = $state('');
  let tab = $state<'tasks' | 'points'>('tasks');

  $effect(() => {
    const id = page.params.id;
    Promise.all([api.get<StatsDto>(`/v1/members/${id}/stats`), api.get<PointsDto>(`/v1/members/${id}/points`)])
      .then(([s, p]) => {
        stats = s;
        points = p;
      })
      .catch((e) => (error = errorMessage(e)));
  });

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

<style>
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
