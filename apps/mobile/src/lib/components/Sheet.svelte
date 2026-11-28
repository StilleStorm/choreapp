<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    children,
    onclose,
  }: { open?: boolean; title?: string; children: Snippet; onclose?: () => void } = $props();

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function close() {
    open = false;
    onclose?.();
  }
</script>

<dialog
  bind:this={dialog}
  onclose={close}
  onclick={(e) => {
    if (e.target === dialog) close();
  }}
>
  <div class="sheet">
    <div class="handle"></div>
    {#if title}
      <div class="head">
        <h2>{title}</h2>
        <button class="icon-btn" aria-label="Zamknij" onclick={close}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    {/if}
    {#if open}
      {@render children()}
    {/if}
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    padding: 0;
    margin: auto auto 0;
    width: 100%;
    max-width: 640px;
    max-height: 92vh;
    max-height: 92dvh;
    background: transparent;
    color: var(--text);
  }
  dialog::backdrop {
    background: rgb(10 12 16 / 45%);
  }
  .sheet {
    background: var(--surface);
    border-radius: 22px 22px 0 0;
    padding: 8px 16px calc(var(--safe-bottom) + 20px);
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-height: 92vh;
    max-height: 92dvh;
    overflow-y: auto;
    animation: up 0.2s ease-out;
  }
  .handle {
    width: 40px;
    height: 5px;
    border-radius: 3px;
    background: var(--border);
    margin: 0 auto;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  @keyframes up {
    from {
      transform: translateY(30%);
      opacity: 0.6;
    }
  }
</style>
