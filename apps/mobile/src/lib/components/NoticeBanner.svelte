<script lang="ts">
  import { goto } from '$app/navigation';
  import { NOTICE_MS, notices } from '../notices.svelte.js';
  import { packs } from '../packs.svelte.js';
  import Icon from './Icon.svelte';

  // Not over a pack being opened: the notice waits for the last one to close.
  const visible = $derived(notices.current && !packs.current ? notices.current : null);

  // The 6 s start when the notice is actually seen; sticky ones stay.
  $effect(() => {
    const n = visible;
    if (!n || n.sticky) return;
    const t = setTimeout(() => notices.current === n && notices.dismiss(), NOTICE_MS);
    return () => clearTimeout(t);
  });
</script>

{#if visible}
  {@const n = visible}
  <div class="notice" role="status">
    <button
      class="main"
      onclick={() => {
        // Read the link first: once dismissed, `n` is gone.
        const href = n.href;
        notices.dismiss();
        void goto(href);
      }}
    >
      <span class="bell"><Icon name="bell" size={20} /></span>
      <span class="text">
        <strong>{n.title}</strong>
        {#if n.body}<span>{n.body}</span>{/if}
      </span>
    </button>
    {#if n.sticky}
      <button class="close" aria-label="Zamknij powiadomienie" onclick={() => notices.dismiss()}>
        <Icon name="x" size={18} />
      </button>
    {/if}
  </div>
{/if}

<style>
  .notice {
    position: fixed;
    top: calc(var(--safe-top) + 8px);
    left: 12px;
    right: 12px;
    z-index: 60;
    display: flex;
    align-items: center;
    background: #1f232a;
    color: #fff;
    border-radius: 16px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 25%);
    animation: drop 0.25s ease-out;
  }
  .main,
  .close {
    appearance: none;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    padding: 12px 14px;
  }
  .close {
    flex: none;
    width: 44px;
    height: 44px;
    margin-right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    opacity: 0.8;
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
