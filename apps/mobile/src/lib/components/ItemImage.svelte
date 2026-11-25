<script lang="ts">
  import type { Rarity } from '@choreapp/core';

  let {
    url,
    name,
    rarity,
    locked = false,
    size = 72,
  }: { url: string; name: string; rarity: Rarity; locked?: boolean; size?: number } = $props();
</script>

<span class="item" data-rarity={rarity} class:locked style:width="{size}px" style:height="{size}px">
  <img src={url} alt={locked ? 'Jeszcze nie masz' : name} loading="lazy" decoding="async" />
</span>

<style>
  .item {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 18px;
    background: var(--surface-2);
    padding: 10%;
    flex: none;
  }
  .item img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .item[data-rarity='rare'] {
    box-shadow: inset 0 0 0 3px #4ea8de;
    background: #e3f2fd;
  }
  .item[data-rarity='legendary'] {
    box-shadow: inset 0 0 0 3px #e0a800;
    background: linear-gradient(135deg, #fff6cc, #ffe08a);
  }
  .item.locked img {
    filter: grayscale(1) brightness(0.2);
    opacity: 0.25;
  }
</style>
