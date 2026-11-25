<script lang="ts">
  import { taskIconUrl } from '../taskIcons.js';

  let { icon, size = 40 }: { icon: string; size?: number } = $props();
</script>

<img class="task-icon" src={taskIconUrl(icon)} alt="" width={size} height={size} loading="lazy" decoding="async" />

<style>
  .task-icon {
    flex: none;
    display: block;
  }
</style>
