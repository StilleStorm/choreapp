<script lang="ts" module>
  import type { ChildTaskState } from '@choreapp/core';

  export const STATE_LABELS: Record<ChildTaskState, string> = {
    upcoming: 'Później',
    todo: 'Do zrobienia',
    overdue: 'Zaległe',
    reported: 'Do sprawdzenia',
    approved: 'Zrobione',
    closed: 'Zrobione przez rodzeństwo',
  };
  const CLASSES: Record<ChildTaskState, string> = {
    upcoming: '',
    todo: '',
    overdue: 'danger',
    reported: 'warning',
    approved: 'success',
    closed: 'success',
  };
</script>

<script lang="ts">
  let { state }: { state: ChildTaskState } = $props();
</script>

<span class="badge {CLASSES[state]}">{STATE_LABELS[state]}</span>
