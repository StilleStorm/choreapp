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
  {#if locked}
    <!-- Dark silhouette via a mask: cheaper to draw in big grids than a CSS filter on the image. -->
    <span class="silhouette" role="img" aria-label="Jeszcze nie masz" style:--src={`url("${url}")`}></span>
  {:else}
    <img src={url} alt={name} loading="lazy" decoding="async" />
  {/if}
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
  .item img,
  .silhouette {
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
  .silhouette {
    display: block;
    background: #000;
    opacity: 0.2;
    -webkit-mask: var(--src) center / contain no-repeat;
    mask: var(--src) center / contain no-repeat;
  }
</style>
