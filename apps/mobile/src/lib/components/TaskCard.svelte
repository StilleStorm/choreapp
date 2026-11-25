<script lang="ts">
  import type { AgendaChildDto, AgendaItemDto } from '@choreapp/shared';
  import { relativeDay } from '../format.js';
  import TaskIcon from './TaskIcon.svelte';

  let {
    item,
    child,
    today,
    parentLabel = 'mamę/tatę',
    pending = false,
    doneText = 'Zrobiłem!',
    onreport,
  }: {
    item: AgendaItemDto;
    child: AgendaChildDto;
    today: string;
    parentLabel?: string;
    /** Report queued offline, not yet confirmed by the server. */
    pending?: boolean;
    doneText?: string;
    onreport?: () => void;
  } = $props();

  const state = $derived(pending ? 'reported' : child.state);
</script>

<article class="task-card" data-state={state}>
  <div class="icon-wrap"><TaskIcon icon={item.icon} size={52} /></div>
  <div class="body">
    <h3 class="title">{item.title}</h3>
    <p class="meta">
      {#if state === 'overdue'}
        <span class="flag overdue">Zaległe · {relativeDay(item.date, today)}</span>
      {:else if item.date !== today}
        <span>{relativeDay(item.date, today)}</span>
      {/if}
      {#if item.dueTime}<span>do {item.dueTime}</span>{/if}
      <span class="points">+{item.points}</span>
    </p>
    {#if item.description}<p class="desc">{item.description}</p>{/if}
    {#if child.rejection && (state === 'todo' || state === 'overdue')}
      <p class="rejection">↩ Do poprawki{child.rejection.comment ? `: ${child.rejection.comment}` : ''}</p>
    {/if}
  </div>
  <div class="action">
    {#if state === 'reported'}
      <span class="status waiting">{pending ? 'Wysyłam…' : `Czeka na ${parentLabel}`}</span>
    {:else if state === 'approved'}
      <span class="status done">Zrobione ✓</span>
    {:else if state === 'closed'}
      <span class="status done">Zrobione ✓</span>
    {:else if child.canReport && onreport}
      <button class="done-btn" onclick={onreport}>{doneText}</button>
    {/if}
  </div>
</article>

<style>
  .task-card {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'icon body' 'action action';
    gap: 10px 12px;
    align-items: center;
    background: var(--card-bg, var(--surface));
    color: var(--card-text, var(--text));
    border: var(--card-border, 0);
    border-radius: var(--card-radius, var(--radius));
    box-shadow: var(--card-shadow, var(--shadow));
    padding: 14px;
  }
  .icon-wrap {
    grid-area: icon;
    width: 64px;
    height: 64px;
    border-radius: var(--icon-radius, 18px);
    background: var(--icon-bg, var(--surface-2));
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .body {
    grid-area: body;
    min-width: 0;
  }
  .title {
    font-family: var(--font-display);
    font-size: 1.1rem;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 0.85rem;
    color: var(--muted);
    margin-top: 2px;
  }
  .points {
    font-weight: 800;
    color: var(--points, var(--accent));
  }
  .flag.overdue {
    color: var(--danger);
    font-weight: 700;
  }
  .desc {
    font-size: 0.9rem;
    margin-top: 4px;
    color: var(--muted);
  }
  .rejection {
    margin-top: 6px;
    font-size: 0.85rem;
    background: var(--warning-soft);
    color: var(--warning);
    border-radius: 8px;
    padding: 4px 8px;
    font-weight: 600;
  }
  .action {
    grid-area: action;
  }
  .action:empty {
    display: none;
  }
  .done-btn {
    appearance: none;
    border: var(--btn-border, 0);
    width: 100%;
    min-height: 56px;
    border-radius: var(--btn-radius, 14px);
    background: var(--btn-bg, var(--accent));
    color: var(--btn-text, var(--accent-text));
    box-shadow: var(--btn-shadow, none);
    font: inherit;
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 800;
    cursor: pointer;
    transition: transform 0.08s ease;
  }
  .done-btn:active {
    transform: scale(0.97);
  }
  .status {
    display: block;
    text-align: center;
    border-radius: var(--btn-radius, 14px);
    padding: 10px;
    font-weight: 700;
  }
  .status.waiting {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .status.done {
    background: var(--success-soft);
    color: var(--success);
  }
  .task-card[data-state='approved'],
  .task-card[data-state='closed'] {
    opacity: 0.75;
  }
</style>
