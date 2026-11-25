<script lang="ts">
  import type { TaskInput } from '@choreapp/shared';
  import { goto } from '$app/navigation';
  import { api } from '#lib/api.js';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import TaskForm from '#lib/components/TaskForm.svelte';
  import { errorMessage } from '#lib/messages.js';

  let busy = $state(false);
  let error = $state('');

  async function save(input: TaskInput) {
    busy = true;
    error = '';
    try {
      await api.post('/v1/tasks', input);
      await goto('/parent/tasks', { replace: true });
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  <BackHeader title="Nowe zadanie" back="/parent/tasks" />
  {#if error}<div class="error-box">{error}</div>{/if}
  <TaskForm submitLabel="Dodaj zadanie" {busy} onsubmit={save} />
</main>
