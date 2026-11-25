<script lang="ts">
  import type { TaskDto, TaskInput } from '@choreapp/shared';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import TaskForm from '#lib/components/TaskForm.svelte';
  import { errorMessage } from '#lib/messages.js';

  let task = $state<TaskDto | null>(null);
  let busy = $state(false);
  let error = $state('');
  let confirmDelete = $state(false);

  $effect(() => {
    api
      .get<TaskDto>(`/v1/tasks/${page.params.id}`)
      .then((t) => (task = t))
      .catch((e) => (error = errorMessage(e)));
  });

  async function save(input: TaskInput) {
    busy = true;
    error = '';
    try {
      await api.patch(`/v1/tasks/${page.params.id}`, input);
      await goto('/parent/tasks', { replace: true });
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    try {
      await api.del(`/v1/tasks/${page.params.id}`);
      await goto('/parent/tasks', { replace: true });
    } catch (e) {
      error = errorMessage(e);
    }
  }
</script>

<main class="screen">
  <BackHeader title="Edytuj zadanie" back="/parent/tasks" />
  {#if error}<div class="error-box">{error}</div>{/if}
  {#if task}
    <TaskForm initial={task} submitLabel="Zapisz zmiany" {busy} onsubmit={save} />

    <section class="section">
      {#if confirmDelete}
        <div class="card stack">
          <p>
            {task.recurrence.kind === 'once'
              ? 'Usunąć to zadanie?'
              : 'Usunąć całą serię? Przyszłe i zaległe dni znikną, zrobione zostają w historii.'}
          </p>
          <p class="muted small">Pojedynczy dzień usuniesz w zakładce Dziś albo Tydzień.</p>
          <div class="inline">
            <button class="btn grow" onclick={() => (confirmDelete = false)}>Anuluj</button>
            <button class="btn danger grow" onclick={remove}>Usuń</button>
          </div>
        </div>
      {:else}
        <button class="btn ghost block danger-text" onclick={() => (confirmDelete = true)}>
          <Icon name="trash" size={20} />
          {task.recurrence.kind === 'once' ? 'Usuń zadanie' : 'Usuń całą serię'}
        </button>
      {/if}
    </section>
  {:else if !error}
    <p class="empty">Wczytywanie…</p>
  {/if}
</main>

<style>
  .grow {
    flex: 1;
  }
  .danger-text {
    color: var(--danger);
  }
</style>
