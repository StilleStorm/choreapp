<script lang="ts">
  import { addDays } from '@choreapp/core';
  import type { AgendaDto, AgendaItemDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import TaskIcon from '#lib/components/TaskIcon.svelte';
  import { capitalize, dayMonth, weekdayName } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  let agenda = $state<AgendaDto | null>(null);
  let error = $state('');

  // Only a new day reloads, not every /me refresh.
  const today = $derived(session.today);
  $effect(() => {
    const from = addDays(today, 1);
    api
      .get<AgendaDto>(`/v1/agenda?from=${from}&to=${addDays(from, 6)}`)
      .then((a) => (agenda = a))
      .catch((e) => (error = errorMessage(e)));
  });

  const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(session.today, i + 1)));
  function itemsOn(d: string): AgendaItemDto[] {
    return agenda?.items.filter((i) => i.date === d) ?? [];
  }
</script>

<main class="screen">
  <header class="screen-header">
    <div>
      <h1>Tydzień</h1>
      <p class="sub">Co czeka w kolejnych dniach</p>
    </div>
  </header>
  {#if error}<div class="error-box">{error}</div>{/if}

  {#if agenda}
    {#each days as d (d)}
      {@const items = itemsOn(d)}
      <section class="day">
        <h2 class="day-title"><span class="wd">{capitalize(weekdayName(d))}</span> <span class="muted">{dayMonth(d)}</span></h2>
        {#if items.length === 0}
          <p class="muted small free">Wolne!</p>
        {:else}
          <div class="list">
            {#each items as item (item.occurrenceId)}
              <div class="row">
                <TaskIcon icon={item.icon} size={36} />
                <span class="grow title">{item.title}</span>
                {#if item.dueTime}<span class="muted small">do {item.dueTime}</span>{/if}
                <span class="badge accent">+{item.points}</span>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  {:else if !error}
    <p class="empty">Wczytywanie…</p>
  {/if}
</main>

<style>
  .day {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .day-title {
    font-size: 1rem;
  }
  .free {
    padding-left: 4px;
  }
  .grow {
    flex: 1;
  }
</style>
