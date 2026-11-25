<script lang="ts">
  import type { AgendaItemDto } from '@choreapp/shared';
  import { goto } from '$app/navigation';
  import { api } from '../api.js';
  import { longDate } from '../format.js';
  import { errorMessage } from '../messages.js';
  import { session } from '../session.svelte.js';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import StateBadge from './StateBadge.svelte';
  import TaskIcon from './TaskIcon.svelte';

  let {
    open = $bindable(false),
    item,
    onchange,
  }: { open?: boolean; item: AgendaItemDto | null; onchange: () => void } = $props();

  let confirm = $state<'day' | 'series' | null>(null);
  let error = $state('');

  $effect(() => {
    if (open) {
      confirm = null;
      error = '';
    }
  });

  async function deleteDay() {
    if (!item) return;
    try {
      await api.del(`/v1/occurrences/${item.occurrenceId}`);
      open = false;
      onchange();
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function deleteSeries() {
    if (!item) return;
    try {
      await api.del(`/v1/tasks/${item.taskId}`);
      open = false;
      onchange();
    } catch (e) {
      error = errorMessage(e);
    }
  }
</script>

<Sheet bind:open title={item?.title}>
  {#if item}
    <div class="head">
      <TaskIcon icon={item.icon} size={56} />
      <div>
        <p>{longDate(item.date)}{item.dueTime ? `, do ${item.dueTime}` : ''}</p>
        <p class="muted small">{item.points} pkt{item.recurring ? ' · powtarzające się' : ''}</p>
      </div>
    </div>
    {#if item.description}<p>{item.description}</p>{/if}

    <div class="list">
      {#each item.children as ch (ch.memberId)}
        {@const m = session.member(ch.memberId)}
        <div class="row">
          <Avatar name={m?.name ?? '?'} url={m?.avatarUrl} size={32} />
          <span class="grow">{m?.name}</span>
          <StateBadge state={ch.state} />
        </div>
      {/each}
    </div>

    {#if error}<div class="error-box">{error}</div>{/if}

    {#if confirm === 'day'}
      <div class="card stack">
        <p>Usunąć zadanie tylko z tego dnia?</p>
        <div class="inline">
          <button class="btn grow" onclick={() => (confirm = null)}>Anuluj</button>
          <button class="btn danger grow" onclick={deleteDay}>Usuń ten dzień</button>
        </div>
      </div>
    {:else if confirm === 'series'}
      <div class="card stack">
        <p>Usunąć całą serię? Przyszłe i zaległe dni znikną, zrobione zostają w historii.</p>
        <div class="inline">
          <button class="btn grow" onclick={() => (confirm = null)}>Anuluj</button>
          <button class="btn danger grow" onclick={deleteSeries}>Usuń serię</button>
        </div>
      </div>
    {:else}
      <div class="stack">
        <button class="btn block" onclick={() => goto(`/parent/tasks/${item.taskId}`)}>
          <Icon name="edit" size={20} />
          {item.recurring ? 'Edytuj serię' : 'Edytuj zadanie'}
        </button>
        <button class="btn block danger" onclick={() => (confirm = 'day')}>
          <Icon name="trash" size={20} />
          {item.recurring ? 'Usuń tylko ten dzień' : 'Usuń zadanie'}
        </button>
        {#if item.recurring}
          <button class="btn ghost block danger-text" onclick={() => (confirm = 'series')}>Usuń całą serię</button>
        {/if}
      </div>
    {/if}
  {/if}
</Sheet>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .grow {
    flex: 1;
  }
  .danger-text {
    color: var(--danger);
  }
</style>
