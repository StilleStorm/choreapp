<script lang="ts">
  /** "Press back again to exit" (Android, root screens only). */
  import { backNotice } from '../back.svelte.js';
</script>

{#if backNotice.shown}
  <div class="back-notice" role="status">Naciśnij Wstecz jeszcze raz, aby wyjść</div>
{/if}

<style>
  .back-notice {
    position: fixed;
    left: 50%;
    bottom: calc(var(--tabbar-h, 0px) + var(--safe-bottom) + 16px);
    z-index: 200;
    max-width: calc(100% - 32px);
    transform: translateX(-50%);
    padding: 10px 18px;
    border: 2px solid var(--outline, var(--border));
    border-radius: 999px;
    background: var(--text);
    color: var(--surface);
    font-family: var(--font);
    font-weight: 700;
    font-size: 0.95rem;
    text-align: center;
    box-shadow: var(--shadow);
    pointer-events: none;
    animation: back-notice-in 0.2s ease-out;
  }
  @keyframes back-notice-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }
</style>
