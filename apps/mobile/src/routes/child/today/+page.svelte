<script lang="ts">
  import type { AgendaDto, AgendaItemDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import TaskCard from '#lib/components/TaskCard.svelte';
  import TaskIcon from '#lib/components/TaskIcon.svelte';
  import { longDate, parentAccusative } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { doneLabel } from '#lib/doneLabel.svelte.js';
  import { offline } from '#lib/offline.svelte.js';
  import { session } from '#lib/session.svelte.js';

  let agenda = $state<AgendaDto | null>(null);
  let error = $state('');
  let toast = $state('');

  async function load() {
    try {
      agenda = await api.get<AgendaDto>('/v1/agenda?overdue=1');
      error = '';
    } catch (e) {
      error = errorMessage(e);
    }
  }

  $effect(() => {
    void load();
    const off = offline.onFlushed(load);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  const me = $derived(session.me!);
  const today = $derived(agenda?.today ?? session.today);
  const overdue = $derived(agenda?.items.filter((i) => i.date < today) ?? []);
  const todays = $derived(agenda?.items.filter((i) => i.date === today) ?? []);
  // A "wystarczy jedno" task a sibling did is no longer this child's: not in the progress.
  const mine = $derived(todays.filter((i) => child(i).state !== 'closed'));
  const doneCount = $derived(mine.filter((i) => ['approved', 'reported'].includes(child(i).state) || offline.isQueued(i.occurrenceId)).length);

  function child(i: AgendaItemDto) {
    return i.children[0]!;
  }

  // "Czeka na mamę/tatę"
  const parentLabel = $derived(parentAccusative(session.parents.map((p) => p.name)));

  async function report(item: AgendaItemDto) {
    try {
      const r = await offline.report(item.occurrenceId);
      toast = r === 'queued' ? 'Zapisane! Wyślę, gdy wróci internet.' : 'Super! Czeka na sprawdzenie.';
      setTimeout(() => (toast = ''), 2500);
      await load();
    } catch (e) {
      toast = errorMessage(e);
      setTimeout(() => (toast = ''), 3500);
      await load();
    }
  }
</script>

<main class="screen child-today">
  <header class="hello">
    <Avatar name={me.name} url={me.avatarUrl} frameUrl={me.frameUrl} size={56} />
    <div>
      <h1>Cześć, {me.name}!</h1>
      <p class="sub">{longDate(today)}</p>
    </div>
  </header>

  {#if !offline.online}
    <div class="info-box">Brak internetu. „Zrobiłem” zapisze się na telefonie i wyśle później.</div>
  {/if}
  {#if error}<div class="error-box">{error}</div>{/if}

  {#if agenda}
    {#if mine.length > 0}
      <div class="progress" aria-label="Zrobione {doneCount} z {mine.length}">
        <div class="bar"><span style:width="{(doneCount / mine.length) * 100}%"></span></div>
        <span class="label">{doneCount} z {mine.length}</span>
      </div>
    {/if}

    {#if overdue.length > 0}
      <section class="section">
        <h2 class="section-title overdue-title">Zaległe</h2>
        {#each overdue as item (item.occurrenceId)}
          <TaskCard {item} child={child(item)} {today} {parentLabel} pending={offline.isQueued(item.occurrenceId)} doneText={doneLabel.for(me.theme)} onreport={() => report(item)} />
        {/each}
      </section>
    {/if}

    <section class="section">
      <h2 class="section-title">Na dziś</h2>
      {#each todays as item (item.occurrenceId)}
        <TaskCard {item} child={child(item)} {today} {parentLabel} pending={offline.isQueued(item.occurrenceId)} doneText={doneLabel.for(me.theme)} onreport={() => report(item)} />
      {:else}
        <div class="card empty">
          <p class="big-emoji"><TaskIcon icon="party" size={64} /></p>
          <p>Na dziś nie ma zadań. Wolne!</p>
        </div>
      {/each}
    </section>
  {:else if !error}
    <p class="empty">Wczytywanie…</p>
  {/if}
</main>

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
  .hello {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .hello .sub {
    color: var(--muted);
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .bar {
    flex: 1;
    height: 12px;
    border-radius: 6px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--progress, var(--accent));
    border-radius: 6px;
    transition: width 0.4s ease;
  }
  .progress .label {
    font-weight: 800;
    font-size: 0.9rem;
  }
  .overdue-title {
    color: var(--danger);
  }
  .big-emoji {
    font-size: 2.5rem;
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
    animation: pop 0.2s ease-out;
  }
  @keyframes pop {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
  }
</style>
