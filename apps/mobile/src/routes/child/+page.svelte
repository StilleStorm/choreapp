<script lang="ts">
  import { goto } from '$app/navigation';

  $effect(() => {
    void goto('/child/today', { replaceState: true });
  });
</script>
