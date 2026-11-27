<script lang="ts">
  import type { AgendaChildDto, AgendaItemDto, ParentCompleteResultDto } from '@choreapp/shared';
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
  /** "Zrobione" waiting for the parent's confirmation (member id). */
  let doneFor = $state<string | null>(null);
  let busy = $state(false);
  let doneMsg = $state('');
  /** Marked done while the sheet is open (the agenda reloads behind it). */
  let doneNow = $state<Record<string, true>>({});
  /** One idempotency key per child per opening: a double tap or a retry pays once. */
  let opIds: Record<string, string> = {};

  $effect(() => {
    if (open) {
      confirm = null;
      error = '';
      doneFor = null;
      doneMsg = '';
      doneNow = {};
      opIds = {};
    }
  });

  /** The parent can tick off today's and overdue tasks, and approve a waiting report. */
  function canMarkDone(ch: AgendaChildDto): boolean {
    // "Wystarczy jedno": once one child has it, it's closed for the others.
    if (item?.sharedMode === 'any' && Object.keys(doneNow).length > 0) return false;
    return !doneNow[ch.memberId] && ['todo', 'overdue', 'reported'].includes(ch.state);
  }

  async function markDone(memberId: string) {
    if (!item || busy) return;
    busy = true;
    error = '';
    const name = session.member(memberId)?.name ?? '';
    try {
      opIds[memberId] ??= crypto.randomUUID();
      const r = await api.post<ParentCompleteResultDto>(`/v1/occurrences/${item.occurrenceId}/complete`, {
        memberId,
        clientOpId: opIds[memberId],
      });
      doneNow[memberId] = true;
      const extras: string[] = [];
      if (r.drop && r.drop.items.length > 0) extras.push(r.drop.items.length === 1 ? 'naklejka' : `${r.drop.items.length} naklejki`);
      if (r.drop && r.drop.fallbackPoints > 0) extras.push(`+${r.drop.fallbackPoints} pkt bonusu`);
      doneMsg = `${name}: zrobione! +${r.drop?.points ?? item.points} pkt${extras.length ? ` i ${extras.join(', ')}` : ''}`;
      doneFor = null;
      onchange();
    } catch (e) {
      error = errorMessage(e);
      doneFor = null;
      onchange();
    } finally {
      busy = false;
    }
  }

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
          <StateBadge
            state={doneNow[ch.memberId] ? 'approved' : item.sharedMode === 'any' && Object.keys(doneNow).length > 0 ? 'closed' : ch.state}
          />
          {#if canMarkDone(ch) && !confirm}
            <button class="btn small success" disabled={busy} onclick={() => (doneFor = ch.memberId)}>
              {ch.state === 'reported' ? 'Zatwierdź' : 'Zrobione'}
            </button>
          {/if}
        </div>
      {/each}
    </div>

    {#if doneMsg}<p class="done-msg">{doneMsg}</p>{/if}

    {#if doneFor}
      {@const name = session.member(doneFor)?.name ?? ''}
      <div class="card stack">
        <p>Oznaczyć jako zrobione przez: <strong>{name}</strong>? {name} dostanie {item.points} pkt.</p>
        <div class="inline">
          <button class="btn grow" disabled={busy} onclick={() => (doneFor = null)}>Anuluj</button>
          <button class="btn success grow" disabled={busy} onclick={() => doneFor && markDone(doneFor)}>Tak, zrobione</button>
        </div>
      </div>
    {/if}

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
    {:else if !doneFor}
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
  .done-msg {
    color: var(--success);
    font-weight: 700;
  }
  .danger-text {
    color: var(--danger);
  }
</style>
