<script lang="ts">
  import { isoWeekday, parseDate, POINT_SIZES, type Recurrence, type Weekday } from '@choreapp/core';
  import type { TaskDto, TaskInput } from '@choreapp/shared';
  import { untrack } from 'svelte';
  import { plural } from '../format.js';
  import { session } from '../session.svelte.js';
  import { DEFAULT_TASK_ICON } from '../taskIcons.js';
  import Avatar from './Avatar.svelte';
  import IconPicker from './IconPicker.svelte';

  let {
    initial = null,
    busy = false,
    submitLabel,
    onsubmit,
  }: { initial?: TaskDto | null; busy?: boolean; submitLabel: string; onsubmit: (input: TaskInput) => void } = $props();

  type Mode = 'once' | 'daily' | 'days' | 'everyN' | 'monthly';
  const DAY_LABELS: [Weekday, string][] = [
    [1, 'Pn'],
    [2, 'Wt'],
    [3, 'Śr'],
    [4, 'Cz'],
    [5, 'Pt'],
    [6, 'So'],
    [7, 'Nd'],
  ];

  function modeOf(r: Recurrence): Mode {
    if (r.kind === 'weekly') return r.interval > 1 ? 'everyN' : 'days';
    return r.kind;
  }

  // The form is seeded once from `initial`; later prop changes don't reset typing.
  const init = untrack(() => initial);
  const today = session.today;
  let title = $state(init?.title ?? '');
  let icon = $state(init?.icon ?? DEFAULT_TASK_ICON);
  let description = $state(init?.description ?? '');
  let assignees = $state<string[]>(init?.assignees ?? (session.children.length === 1 ? [session.children[0]!.id] : []));
  let sharedMode = $state<'each' | 'any'>(init?.sharedMode ?? 'each');
  // When editing a running series, the form starts from today (the edit only affects the future).
  let startDate = $state(init ? (init.startDate < today && init.recurrence.kind !== 'once' ? today : init.startDate) : today);
  let hasDueTime = $state(!!init?.dueTime);
  let dueTime = $state(init?.dueTime ?? '18:00');
  let mode = $state<Mode>(init ? modeOf(init.recurrence) : 'once');
  let days = $state<Weekday[]>(init?.recurrence.kind === 'weekly' ? [...init.recurrence.days] : [isoWeekday(today) as Weekday]);
  let interval = $state(init?.recurrence.kind === 'weekly' && init.recurrence.interval > 1 ? init.recurrence.interval : 2);
  let monthDay = $state(init?.recurrence.kind === 'monthly' ? init.recurrence.day : parseDate(today).d);
  let points = $state<number>(init?.points ?? POINT_SIZES.medium);
  let error = $state('');

  function toggleChild(id: string) {
    assignees = assignees.includes(id) ? assignees.filter((a) => a !== id) : [...assignees, id];
  }
  function toggleDay(d: Weekday) {
    days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
  }

  function recurrence(): Recurrence {
    switch (mode) {
      case 'once':
        return { kind: 'once' };
      case 'daily':
        return { kind: 'daily' };
      case 'days':
        return { kind: 'weekly', interval: 1, days };
      case 'everyN':
        return { kind: 'weekly', interval, days };
      case 'monthly':
        return { kind: 'monthly', day: monthDay };
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    if (!title.trim()) return void (error = 'Wpisz nazwę zadania.');
    if (assignees.length === 0) return void (error = 'Wybierz, kto ma zrobić zadanie.');
    if ((mode === 'days' || mode === 'everyN') && days.length === 0) return void (error = 'Wybierz co najmniej jeden dzień tygodnia.');
    onsubmit({
      title: title.trim(),
      icon,
      description: description.trim() || null,
      assignees,
      sharedMode: assignees.length > 1 ? sharedMode : 'each',
      startDate,
      dueTime: hasDueTime ? dueTime : null,
      recurrence: recurrence() as TaskInput['recurrence'],
      points: points as 5 | 10 | 20,
    });
  }
</script>

<form class="stack" onsubmit={submit}>
  <label class="field">
    <span>Nazwa</span>
    <input type="text" bind:value={title} maxlength="80" placeholder="np. Posprzątaj pokój" required />
  </label>

  <IconPicker bind:value={icon} />

  <label class="field">
    <span>Opis (opcjonalnie)</span>
    <textarea bind:value={description} maxlength="500" placeholder="Szczegóły, np. „razem z biurkiem”"></textarea>
  </label>

  <div class="field">
    <span>Kto</span>
    {#if session.children.length === 0}
      <p class="muted small">Najpierw dodaj dziecko w Ustawieniach.</p>
    {/if}
    <div class="chips">
      {#each session.children as child (child.id)}
        <button type="button" class="chip" aria-pressed={assignees.includes(child.id)} onclick={() => toggleChild(child.id)}>
          <Avatar name={child.name} url={child.avatarUrl} size={26} />
          {child.name}
        </button>
      {/each}
    </div>
  </div>

  {#if assignees.length > 1}
    <div class="field">
      <span>Jak robią</span>
      <div class="segmented" role="group">
        <button type="button" aria-pressed={sharedMode === 'each'} onclick={() => (sharedMode = 'each')}>Każde osobno</button>
        <button type="button" aria-pressed={sharedMode === 'any'} onclick={() => (sharedMode = 'any')}>Wystarczy jedno</button>
      </div>
      <span class="hint">
        {sharedMode === 'each' ? 'Każde dziecko robi zadanie i dostaje punkty.' : 'Zadanie znika, gdy zatwierdzisz je u jednego dziecka.'}
      </span>
    </div>
  {/if}

  <div class="field">
    <span>Powtarzanie</span>
    <select bind:value={mode}>
      <option value="once">Jednorazowo</option>
      <option value="daily">Codziennie</option>
      <option value="days">Wybrane dni tygodnia</option>
      <option value="everyN">Co kilka tygodni</option>
      <option value="monthly">Co miesiąc</option>
    </select>
  </div>

  {#if mode === 'everyN'}
    <label class="field">
      <span>Co ile tygodni</span>
      <select bind:value={interval}>
        {#each [2, 3, 4, 5, 6, 8, 12] as n (n)}<option value={n}>co {n} {plural(n, 'tydzień', 'tygodnie', 'tygodni')}</option>{/each}
      </select>
    </label>
  {/if}
  {#if mode === 'days' || mode === 'everyN'}
    <div class="days" role="group" aria-label="Dni tygodnia">
      {#each DAY_LABELS as [d, label] (d)}
        <button type="button" class="day" aria-pressed={days.includes(d)} onclick={() => toggleDay(d)}>{label}</button>
      {/each}
    </div>
  {/if}
  {#if mode === 'monthly'}
    <label class="field">
      <span>Dzień miesiąca</span>
      <select bind:value={monthDay}>
        {#each Array.from({ length: 31 }, (_, i) => i + 1) as d (d)}<option value={d}>{d}.</option>{/each}
      </select>
      {#if monthDay > 28}<span class="hint">W krótszych miesiącach zadanie wypadnie ostatniego dnia.</span>{/if}
    </label>
  {/if}

  <label class="field">
    <span>{mode === 'once' ? 'Termin' : 'Od kiedy'}</span>
    <input type="date" bind:value={startDate} required />
    {#if initial && initial.recurrence.kind !== 'once'}
      <span class="hint">Zmiany dotyczą tylko przyszłości. Zrobione zadania zostają bez zmian.</span>
    {/if}
  </label>

  <label class="inline">
    <input type="checkbox" bind:checked={hasDueTime} />
    <span>Do konkretnej godziny</span>
  </label>
  {#if hasDueTime}
    <label class="field">
      <span>Godzina</span>
      <input type="time" bind:value={dueTime} required />
      <span class="hint">Po tej godzinie zadanie będzie zaległe.</span>
    </label>
  {/if}

  <div class="field">
    <span>Punkty</span>
    <div class="segmented" role="group">
      <button type="button" aria-pressed={points === 5} onclick={() => (points = 5)}>Małe · 5</button>
      <button type="button" aria-pressed={points === 10} onclick={() => (points = 10)}>Średnie · 10</button>
      <button type="button" aria-pressed={points === 20} onclick={() => (points = 20)}>Duże · 20</button>
    </div>
  </div>

  {#if error}<div class="error-box" role="alert">{error}</div>{/if}
  <button class="btn primary block" disabled={busy}>{busy ? 'Zapisywanie…' : submitLabel}</button>
</form>

<style>
  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
  }
  .day {
    appearance: none;
    border: 1.5px solid var(--border);
    background: var(--surface);
    border-radius: 10px;
    min-height: 44px;
    font: inherit;
    font-weight: 700;
    color: var(--text);
    cursor: pointer;
  }
  .day[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
</style>
