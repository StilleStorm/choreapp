<script lang="ts">
  import { goto } from '$app/navigation';
  import { session } from '#lib/session.svelte.js';

  $effect(() => {
    void goto(session.home(), { replace: true });
  });
</script>
