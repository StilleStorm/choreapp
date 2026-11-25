<script lang="ts">
  import { squareWebp } from '../image.js';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let {
    name,
    currentUrl = null,
    blob = $bindable(null),
    size = 112,
  }: { name: string; currentUrl?: string | null; blob?: Blob | null; size?: number } = $props();

  let preview = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();
  let error = $state('');

  async function picked(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    error = '';
    try {
      blob = await squareWebp(file);
      if (preview) URL.revokeObjectURL(preview);
      preview = URL.createObjectURL(blob);
    } catch {
      error = 'Nie udało się wczytać tego zdjęcia.';
    }
  }
</script>

<div class="picker">
  <button type="button" class="avatar-btn" onclick={() => input?.click()} aria-label="Wybierz zdjęcie">
    <Avatar {name} url={preview ?? currentUrl} {size} />
    <span class="cam"><Icon name="camera" size={18} /></span>
  </button>
  <input bind:this={input} type="file" accept="image/*" hidden onchange={picked} />
  <button type="button" class="btn ghost small" onclick={() => input?.click()}>
    {preview || currentUrl ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
  </button>
  {#if error}<p class="error-box">{error}</p>{/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .avatar-btn {
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    position: relative;
    cursor: pointer;
  }
  .cam {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 3px solid var(--surface);
  }
</style>
