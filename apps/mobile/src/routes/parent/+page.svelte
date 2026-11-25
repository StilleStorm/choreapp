<script lang="ts">
  import { goto } from '$app/navigation';

  $effect(() => {
    void goto('/parent/today', { replace: true });
  });
</script>
