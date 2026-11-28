<script lang="ts">
  /** Shows the child's unopened sticker packs one after another (child layout). */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { packs } from '../packs.svelte.js';
  import PackStage from './PackStage.svelte';

  // While a pack is open the screen behind it is out of reach (also for TalkBack).
  $effect(() => {
    void page.url.pathname; // again after "Do albumu" swaps the screen behind
    if (!packs.current) return;
    const behind = [...document.querySelectorAll('.child-app > :not(.overlay)')] as HTMLElement[];
    for (const el of behind) el.inert = true;
    return () => {
      for (const el of behind) el.inert = false;
    };
  });

  async function done(album: string | null) {
    await packs.next();
    if (album) await goto(`/child/album/${encodeURIComponent(album)}`);
  }
</script>

{#if packs.current}
  {#key packs.current.key}
    <PackStage pack={packs.current} waiting={packs.queue.length - 1} ondone={done} />
  {/key}
{/if}
