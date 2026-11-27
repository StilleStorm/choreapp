<script lang="ts">
  /** Shows the child's unopened sticker packs one after another (child layout). */
  import { goto } from '$app/navigation';
  import { packs } from '../packs.svelte.js';
  import PackStage from './PackStage.svelte';

  async function done(album: string | null) {
    await packs.next();
    if (album) await goto(`/child/album/${encodeURIComponent(album)}`);
  }
</script>

{#if packs.current}
  {#key packs.current.key}
    <PackStage pack={packs.current} ondone={done} />
  {/key}
{/if}
