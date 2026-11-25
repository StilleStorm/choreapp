<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { title, back, action }: { title: string; back?: string; action?: Snippet } = $props();
</script>

<header class="back-header">
  {#if back}
    <a class="icon-btn" href={back} aria-label="Wstecz"><Icon name="back" /></a>
  {/if}
  <h1>{title}</h1>
  <span class="spacer"></span>
  {#if action}{@render action()}{/if}
</header>

<style>
  .back-header {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: -8px;
  }
  h1 {
    font-size: 1.35rem;
  }
</style>
