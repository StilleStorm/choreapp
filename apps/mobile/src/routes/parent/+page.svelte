<script lang="ts">
  import { goto } from '$app/navigation';

  $effect(() => {
    void goto('/parent/today', { replaceState: true });
  });
</script>
