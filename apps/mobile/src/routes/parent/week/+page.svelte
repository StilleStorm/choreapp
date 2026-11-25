<script lang="ts">
  import { addDays, startOfIsoWeek, type LocalDate } from '@choreapp/core';
  import type { AgendaDto, AgendaItemDto, WeekCellDto, WeekDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import OccurrenceSheet from '#lib/components/OccurrenceSheet.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import StateBadge from '#lib/components/StateBadge.svelte';
  import TaskIcon from '#lib/components/TaskIcon.svelte';
  import { dayMonth, longDate, weekdayShort } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  let start = $state<LocalDate>(startOfIsoWeek(session.today));
  let week = $state<WeekDto | null>(null);
  let error = $state('');

  async function load() {
    error = '';
    try {
      week = await api.get<WeekDto>(`/v1/week?start=${start}`);
    } catch (e) {
      error = errorMessage(e);
    }
  }
  $effect(() => {
    void start;
    void load();
  });

  // Day detail for one child
  let dayOpen = $state(false);
  let dayDate = $state<LocalDate>(session.today);
  let dayMember = $state<string>('');
  let dayItems = $state<AgendaItemDto[]>([]);
  async function openDay(memberId: string, date: LocalDate) {
    dayMember = memberId;
    dayDate = date;
    dayItems = [];
    dayOpen = true;
    await loadDay();
  }
  async function loadDay() {
    try {
      const a = await api.get<AgendaDto>(`/v1/agenda?from=${dayDate}&to=${dayDate}&member=${dayMember}`);
      dayItems = a.items;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  let occOpen = $state(false);
  let occItem = $state<AgendaItemDto | null>(null);

  function total(c: WeekCellDto): number {
    return c.done + c.waiting + c.overdue + c.todo + c.upcoming;
  }
</script>

<main class="screen">
  <header class="screen-header">
    <h1>Tydzień</h1>
    <div class="inline nav">
      <button class="icon-btn" aria-label="Poprzedni tydzień" onclick={() => (start = addDays(start, -7))}><Icon name="back" /></button>
      <button class="btn small" onclick={() => (start = startOfIsoWeek(session.today))}>{dayMonth(start)}</button>
      <button class="icon-btn" aria-label="Następny tydzień" onclick={() => (start = addDays(start, 7))}><Icon name="chevron" /></button>
    </div>
  </header>

  {#if error}<div class="error-box">{error}</div>{/if}

  {#if week}
    {#if week.rows.length === 0}
      <p class="empty card">Dodaj dzieci w Ustawieniach, żeby zobaczyć tydzień.</p>
    {:else}
      <div class="card grid-card">
        <table class="grid">
          <thead>
            <tr>
              <th></th>
              {#each week.days as d (d)}
                <th class:today={d === session.today}>
                  <span class="wd">{weekdayShort(d)}</span>
                  <span class="dn">{Number(d.slice(8))}</span>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each week.rows as row (row.memberId)}
              {@const m = session.member(row.memberId)}
              <tr>
                <th class="who"><Avatar name={m?.name ?? '?'} url={m?.avatarUrl} size={32} /></th>
                {#each row.cells as c (c.date)}
                  <td>
                    {#if total(c) > 0}
                      <button
                        class="cell"
                        class:all-done={c.done === total(c)}
                        class:has-overdue={c.overdue > 0}
                        class:has-waiting={c.waiting > 0 && c.overdue === 0}
                        onclick={() => openDay(row.memberId, c.date)}
                        aria-label="{m?.name}, {longDate(c.date)}: zrobione {c.done} z {total(c)}"
                      >
                        {c.done}/{total(c)}
                      </button>
                    {:else}
                      <span class="cell empty-cell">·</span>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="legend small muted">
        <span><i class="sw done"></i> wszystko zrobione</span>
        <span><i class="sw waiting"></i> czeka na sprawdzenie</span>
        <span><i class="sw overdue"></i> zaległe</span>
      </div>
    {/if}
  {:else if !error}
    <p class="empty">Wczytywanie…</p>
  {/if}
</main>

<Sheet bind:open={dayOpen} title="{session.member(dayMember)?.name}: {longDate(dayDate)}">
  <div class="list">
    {#each dayItems as item (item.occurrenceId)}
      {@const ch = item.children[0]}
      <button
        class="row item-row"
        onclick={() => {
          occItem = item;
          dayOpen = false;
          occOpen = true;
        }}
      >
        <TaskIcon icon={item.icon} size={36} />
        <span class="grow title">{item.title}</span>
        {#if ch}<StateBadge state={ch.state} />{/if}
      </button>
    {:else}
      <p class="empty">Brak zadań.</p>
    {/each}
  </div>
</Sheet>

<OccurrenceSheet bind:open={occOpen} item={occItem} onchange={load} />

<style>
  .nav {
    gap: 2px;
  }
  .grid-card {
    padding: 8px 4px;
    overflow-x: auto;
  }
  .grid {
    width: 100%;
    border-collapse: separate;
    border-spacing: 3px;
    table-layout: fixed;
  }
  .grid th {
    font-weight: 600;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .grid th.who {
    width: 40px;
  }
  .grid thead th {
    padding-bottom: 4px;
  }
  .grid th .wd,
  .grid th .dn {
    display: block;
  }
  .grid th .dn {
    font-size: 0.95rem;
    color: var(--text);
  }
  .grid th.today .dn {
    color: var(--accent-ink, var(--accent));
    font-weight: 800;
  }
  .cell {
    appearance: none;
    border: 0;
    width: 100%;
    min-height: 40px;
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cell.all-done {
    background: var(--success-soft);
    color: var(--success);
  }
  .cell.has-waiting {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .cell.has-overdue {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .empty-cell {
    background: transparent;
    color: var(--border);
    cursor: default;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    vertical-align: middle;
  }
  .sw.done {
    background: var(--success);
  }
  .sw.waiting {
    background: var(--warning);
  }
  .sw.overdue {
    background: var(--danger);
  }
  .item-row {
    appearance: none;
    border: 0;
    background: none;
    width: 100%;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .grow {
    flex: 1;
  }
</style>
