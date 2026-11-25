<script lang="ts">
  import type { TaskDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import TaskIcon from '#lib/components/TaskIcon.svelte';
  import { dayMonth } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  let tasks = $state<TaskDto[] | null>(null);
  let error = $state('');

  $effect(() => {
    api
      .get<TaskDto[]>('/v1/tasks')
      .then((t) => (tasks = t))
      .catch((e) => (error = errorMessage(e)));
  });

  const recurring = $derived((tasks ?? []).filter((t) => t.recurrence.kind !== 'once'));
  const oneOff = $derived((tasks ?? []).filter((t) => t.recurrence.kind === 'once').sort((a, b) => a.startDate.localeCompare(b.startDate)));
</script>

<main class="screen">
  <header class="screen-header">
    <h1>Zadania</h1>
    <a class="btn primary small" href="/parent/tasks/new"><Icon name="plus" size={20} /> Nowe</a>
  </header>

  {#if error}<div class="error-box">{error}</div>{/if}

  {#if tasks === null && !error}
    <p class="empty">Wczytywanie…</p>
  {:else if tasks && tasks.length === 0}
    <div class="card empty">
      <p>Nie ma jeszcze zadań.</p>
      <a class="btn primary" href="/parent/tasks/new" style="margin-top: 12px">Dodaj pierwsze zadanie</a>
    </div>
  {/if}

  {#snippet row(t: TaskDto)}
    <a class="row task-row" href="/parent/tasks/{t.id}">
      <TaskIcon icon={t.icon} size={40} />
      <span class="grow">
        <span class="title">{t.title}</span>
        <span class="meta">
          {t.recurrence.kind === 'once' ? dayMonth(t.startDate) : t.recurrenceText}{t.dueTime ? ` · do ${t.dueTime}` : ''}
          {#if t.assignees.length > 1}· {t.sharedMode === 'any' ? 'wystarczy jedno' : 'każde osobno'}{/if}
        </span>
      </span>
      <span class="avatars">
        {#each t.assignees as id (id)}
          {@const m = session.member(id)}
          {#if m}<Avatar name={m.name} url={m.avatarUrl} size={26} />{/if}
        {/each}
      </span>
      <span class="badge accent">{t.points}</span>
    </a>
  {/snippet}

  {#if recurring.length > 0}
    <section class="section">
      <h2 class="section-title">Powtarzające się</h2>
      <div class="list">
        {#each recurring as t (t.id)}{@render row(t)}{/each}
      </div>
    </section>
  {/if}
  {#if oneOff.length > 0}
    <section class="section">
      <h2 class="section-title">Jednorazowe</h2>
      <div class="list">
        {#each oneOff as t (t.id)}{@render row(t)}{/each}
      </div>
    </section>
  {/if}
</main>

<style>
  .task-row {
    color: inherit;
    text-decoration: none;
  }
  .task-row .grow {
    display: flex;
    flex-direction: column;
  }
  .avatars {
    display: flex;
  }
  .avatars :global(.avatar + .avatar) {
    margin-left: -8px;
  }
</style>
