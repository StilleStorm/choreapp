<script lang="ts">
  import type { AgendaDto, AgendaItemDto, ApprovalDto, ApproveResultDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import OccurrenceSheet from '#lib/components/OccurrenceSheet.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import StateBadge from '#lib/components/StateBadge.svelte';
  import TaskIcon from '#lib/components/TaskIcon.svelte';
  import { clockTime, longDate, relativeDay } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';
  import { pendingCounts } from '#lib/badges.svelte.js';

  let approvals = $state<ApprovalDto[]>([]);
  let agenda = $state<AgendaDto | null>(null);
  let error = $state('');
  let toast = $state('');
  let busyId = $state<string | null>(null);

  async function load() {
    try {
      const [a, g] = await Promise.all([api.get<ApprovalDto[]>('/v1/approvals'), api.get<AgendaDto>('/v1/agenda?overdue=1')]);
      approvals = a;
      agenda = g;
      pendingCounts.approvals = a.length;
      error = '';
    } catch (e) {
      error = errorMessage(e);
    }
  }

  $effect(() => {
    void load();
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(load, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  });

  function showToast(msg: string) {
    toast = msg;
    setTimeout(() => (toast = ''), 3000);
  }

  async function approve(a: ApprovalDto) {
    busyId = a.completionId;
    try {
      const r = await api.post<ApproveResultDto>(`/v1/completions/${a.completionId}/approve`);
      const extras: string[] = [];
      if (r.drop.items.length > 0) extras.push(r.drop.items.length === 1 ? 'naklejka' : `${r.drop.items.length} naklejki`);
      if (r.drop.fallbackPoints > 0) extras.push(`+${r.drop.fallbackPoints} pkt bonusu`);
      showToast(`${a.memberName}: +${r.drop.points} pkt${extras.length ? ` i ${extras.join(', ')}` : ''}`);
      await load();
    } catch (e) {
      showToast(errorMessage(e));
      await load();
    } finally {
      busyId = null;
    }
  }

  // Reject with comment
  let rejectOpen = $state(false);
  let rejecting = $state<ApprovalDto | null>(null);
  let comment = $state('');
  function openReject(a: ApprovalDto) {
    rejecting = a;
    comment = '';
    rejectOpen = true;
  }
  async function reject() {
    if (!rejecting) return;
    try {
      await api.post(`/v1/completions/${rejecting.completionId}/reject`, { comment: comment.trim() || null });
      rejectOpen = false;
      showToast('Wróciło do poprawki.');
      await load();
    } catch (e) {
      showToast(errorMessage(e));
    }
  }

  // Day state per child
  const today = $derived(agenda?.today ?? session.today);
  function childItems(id: string): AgendaItemDto[] {
    return agenda?.items.filter((i) => i.children.some((c) => c.memberId === id)) ?? [];
  }
  function stateOf(i: AgendaItemDto, id: string) {
    return i.children.find((c) => c.memberId === id)!.state;
  }

  let occOpen = $state(false);
  let occItem = $state<AgendaItemDto | null>(null);
</script>

<main class="screen">
  <header class="screen-header">
    <div>
      <h1>Dziś</h1>
      <p class="sub">{longDate(today)}</p>
    </div>
  </header>
  {#if error}<div class="error-box">{error}</div>{/if}

  <section class="section">
    <h2 class="section-title">Do sprawdzenia {approvals.length > 0 ? `(${approvals.length})` : ''}</h2>
    {#if approvals.length === 0}
      <p class="card muted small">Nic nie czeka na sprawdzenie.</p>
    {:else}
      {#each approvals as a (a.completionId)}
        {@const m = session.member(a.memberId)}
        <article class="card approval">
          <div class="who">
            <Avatar name={a.memberName} url={m?.avatarUrl} size={36} />
            <div class="grow">
              <strong>{a.memberName}</strong>
              <span class="muted small">
                zgłosił(a) {clockTime(a.reportedAt, session.family!.timezone)}{a.date !== today ? ` · zadanie z ${relativeDay(a.date, today)}` : ''}
              </span>
            </div>
            {#if a.late}<span class="badge danger">po terminie</span>{/if}
          </div>
          <div class="what">
            <TaskIcon icon={a.icon} size={40} />
            <span class="grow title">{a.title}</span>
            <span class="badge accent">+{a.points}</span>
          </div>
          <div class="actions">
            <button class="btn danger" onclick={() => openReject(a)} disabled={busyId === a.completionId}>
              <Icon name="x" size={20} /> Do poprawki
            </button>
            <button class="btn success" onclick={() => approve(a)} disabled={busyId === a.completionId}>
              <Icon name="check" size={20} /> Zatwierdź
            </button>
          </div>
        </article>
      {/each}
    {/if}
  </section>

  {#if agenda}
    {#each session.children as child (child.id)}
      {@const items = childItems(child.id)}
      {@const todays = items.filter((i) => i.date === today)}
      {@const done = todays.filter((i) => ['approved', 'closed'].includes(stateOf(i, child.id))).length}
      <section class="section">
        <div class="child-head">
          <Avatar name={child.name} url={child.avatarUrl} frameUrl={child.frameUrl} size={32} />
          <h2>{child.name}</h2>
          <span class="spacer"></span>
          {#if todays.length > 0}<span class="muted small">{done} z {todays.length} zrobione</span>{/if}
        </div>
        <div class="list">
          {#each items as item (item.occurrenceId)}
            <button
              class="row item-row"
              onclick={() => {
                occItem = item;
                occOpen = true;
              }}
            >
              <TaskIcon icon={item.icon} size={32} />
              <span class="grow">
                <span class="title">{item.title}</span>
                {#if item.date !== today}<span class="meta">{relativeDay(item.date, today)}</span>{/if}
              </span>
              <StateBadge state={stateOf(item, child.id)} />
            </button>
          {:else}
            <p class="empty small">Brak zadań na dziś.</p>
          {/each}
        </div>
      </section>
    {/each}
    {#if session.children.length === 0}
      <div class="card empty">
        <p>Dodaj dziecko w Ustawieniach, a potem pierwsze zadanie.</p>
        <a class="btn primary" style="margin-top: 12px" href="/parent/settings">Przejdź do ustawień</a>
      </div>
    {/if}
  {/if}
</main>

<Sheet bind:open={rejectOpen} title="Do poprawki">
  {#if rejecting}
    <p><strong>{rejecting.memberName}</strong>: {rejecting.title}</p>
    <label class="field">
      <span>Co poprawić? (opcjonalnie)</span>
      <textarea bind:value={comment} maxlength="300" placeholder="np. Pod łóżkiem dalej są klocki"></textarea>
    </label>
    <button class="btn danger block" onclick={reject}>Odeślij do poprawki</button>
  {/if}
</Sheet>

<OccurrenceSheet bind:open={occOpen} item={occItem} onchange={load} />

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
  .approval {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .who,
  .what {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .who .grow {
    display: flex;
    flex-direction: column;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .actions .btn {
    padding: 0 8px;
    white-space: nowrap;
  }
  .child-head {
    display: flex;
    align-items: center;
    gap: 8px;
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
  .item-row .grow {
    display: flex;
    flex-direction: column;
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
  }
</style>
