<script lang="ts">
  /** "Press back again to exit" (Android, root screens only). */
  import { backNotice, EXIT_WINDOW_MS } from '../back.svelte.js';
</script>

{#if backNotice.shown}
  {#key backNotice.key}
    <div class="back-notice" role="status" style:--window="{EXIT_WINDOW_MS}ms">
      Naciśnij Wstecz jeszcze raz, aby wyjść
      <span class="left" aria-hidden="true"></span>
    </div>
  {/key}
{/if}

<style>
  .back-notice {
    position: fixed;
    left: 50%;
    bottom: calc(var(--tabbar-h, 0px) + var(--safe-bottom) + 16px);
    z-index: 200;
    max-width: calc(100% - 32px);
    transform: translateX(-50%);
    padding: 10px 18px 12px;
    border: 2px solid var(--outline, var(--border));
    border-radius: 999px;
    background: var(--text);
    color: var(--surface);
    font-family: var(--font);
    font-weight: 700;
    font-size: 0.95rem;
    text-align: center;
    box-shadow: var(--shadow);
    overflow: hidden;
    pointer-events: none;
    animation: back-notice-in 0.2s ease-out;
  }
  /* Time left to press again: shrinks over the whole window. */
  .left {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--accent);
    transform-origin: 0 50%;
    animation: back-notice-left var(--window) linear forwards;
  }
  @keyframes back-notice-left {
    to {
      transform: scaleX(0);
    }
  }
  @keyframes back-notice-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }
</style>
