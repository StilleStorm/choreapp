<script lang="ts">
  import { goto } from '$app/navigation';
  import { notices } from '../notices.svelte.js';
  import Icon from './Icon.svelte';
</script>

{#if notices.current}
  {@const n = notices.current}
  <button
    class="notice"
    onclick={() => {
      notices.dismiss();
      void goto(n.href);
    }}
  >
    <span class="bell"><Icon name="bell" size={20} /></span>
    <span class="text">
      <strong>{n.title}</strong>
      {#if n.body}<span>{n.body}</span>{/if}
    </span>
  </button>
{/if}

<style>
  .notice {
    position: fixed;
    top: calc(var(--safe-top) + 8px);
    left: 12px;
    right: 12px;
    z-index: 60;
    appearance: none;
    border: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    background: #1f232a;
    color: #fff;
    border-radius: 16px;
    padding: 12px 14px;
    font: inherit;
    box-shadow: 0 8px 24px rgb(0 0 0 / 25%);
    animation: drop 0.25s ease-out;
    cursor: pointer;
  }
  .bell {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgb(255 255 255 / 12%);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .text {
    display: flex;
    flex-direction: column;
    font-size: 0.9rem;
  }
  @keyframes drop {
    from {
      transform: translateY(-120%);
    }
  }
</style>
