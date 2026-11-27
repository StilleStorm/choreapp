<script lang="ts">
  import { REWARD_ICON_GROUPS, REWARD_ICONS, TASK_ICON_GROUPS, TASK_ICONS } from '../taskIcons.js';
  import Sheet from './Sheet.svelte';
  import TaskIcon from './TaskIcon.svelte';

  /** forRewards: the "Nagrody" group first, pocket money at the top. */
  let { value = $bindable(), label = 'Ikonka', forRewards = false }: { value: string; label?: string; forRewards?: boolean } = $props();
  let open = $state(false);
  const groups = $derived(forRewards ? REWARD_ICON_GROUPS : TASK_ICON_GROUPS);
  const icons = $derived(forRewards ? REWARD_ICONS : TASK_ICONS);
  const current = $derived(TASK_ICONS.find((i) => i.id === value));
</script>

<div class="field">
  <span>{label}</span>
  <button type="button" class="picker-btn" onclick={() => (open = true)}>
    <TaskIcon icon={value} size={36} />
    <span class="grow">{current?.label ?? 'Wybierz'}</span>
    <span class="muted small">Zmień</span>
  </button>
</div>

<Sheet bind:open title="Wybierz ikonkę">
  {#each groups as group (group)}
    <section class="group">
      <h3 class="section-title">{group}</h3>
      <div class="grid">
        {#each icons.filter((i) => i.group === group) as icon (icon.id)}
          <button
            type="button"
            class="icon-cell"
            aria-pressed={icon.id === value}
            aria-label={icon.label}
            onclick={() => {
              value = icon.id;
              open = false;
            }}
          >
            <TaskIcon icon={icon.id} size={40} />
            <span>{icon.label}</span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</Sheet>

<style>
  .picker-btn {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .grow {
    flex: 1;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 6px;
  }
  .icon-cell {
    appearance: none;
    border: 2px solid transparent;
    background: var(--surface-2);
    border-radius: 12px;
    padding: 8px 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font: inherit;
    font-size: 0.7rem;
    color: var(--text);
    cursor: pointer;
  }
  .icon-cell span {
    text-align: center;
    line-height: 1.15;
  }
  .icon-cell[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
</style>
