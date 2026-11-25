<script lang="ts">
  import { api } from '#lib/api.js';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import { doneLabel } from '#lib/doneLabel.svelte.js';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';
  import { THEME_LIST } from '#lib/themes/themes.js';

  let error = $state('');
  let busy = $state<string | null>(null);

  async function choose(id: string) {
    if (id === session.me?.theme) return;
    busy = id;
    error = '';
    try {
      await api.patch('/v1/me', { theme: id });
      await session.refresh();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = null;
    }
  }
</script>

<main class="screen">
  <BackHeader title="Wygląd aplikacji" back="/child/profile" />

  <section class="card stack">
    <h2>Przycisk mówi</h2>
    <div class="segmented">
      <button aria-pressed={doneLabel.form === 'm'} onclick={() => doneLabel.set('m')}>Zrobiłem!</button>
      <button aria-pressed={doneLabel.form === 'f'} onclick={() => doneLabel.set('f')}>Zrobiłam!</button>
    </div>
  </section>

  {#if error}<div class="error-box">{error}</div>{/if}

  <h2 class="section-title">Wybierz motyw</h2>
  <div class="themes">
    {#each THEME_LIST as t (t.id)}
      <button
        class="theme"
        aria-pressed={session.me?.theme === t.id}
        onclick={() => choose(t.id)}
        disabled={busy !== null}
        style:background={t.preview.bg}
      >
        <span
          class="mini-card"
          style:background={t.preview.card}
          style:color={t.preview.text}
          style:border={t.preview.border}
          style:border-radius="min({t.preview.radius}, 14px)"
          style:font-family={t.preview.font}
        >
          <span class="mini-title">Pokój</span>
          <span class="mini-btn" style:background={t.preview.accent}>{doneLabel.for(t.id)}</span>
        </span>
        <span class="name" class:dark={t.dark}>{t.title}</span>
        {#if session.me?.theme === t.id}<span class="current">Wybrany</span>{/if}
      </button>
    {/each}
  </div>
</main>

<style>
  .themes {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .theme {
    appearance: none;
    border: 3px solid transparent;
    border-radius: 18px;
    padding: 12px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: pointer;
    position: relative;
    text-align: left;
    font: inherit;
    min-height: 150px;
    background-size: auto;
  }
  .theme[aria-pressed='true'] {
    border-color: var(--accent);
    outline: 3px solid var(--surface);
  }
  .mini-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    box-shadow: 0 1px 3px rgb(0 0 0 / 15%);
  }
  .mini-title {
    font-weight: 800;
    font-size: 0.95rem;
  }
  .mini-btn {
    color: #fff;
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 0.75rem;
    font-weight: 800;
    text-align: center;
    text-shadow: 0 1px 1px rgb(0 0 0 / 30%);
  }
  .name {
    font-size: 0.8rem;
    font-weight: 700;
    color: #1a1a1a;
    background: rgb(255 255 255 / 85%);
    border-radius: 8px;
    padding: 2px 6px;
    width: fit-content;
  }
  .current {
    position: absolute;
    top: -8px;
    right: 8px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.7rem;
    font-weight: 800;
    border-radius: 999px;
    padding: 2px 8px;
  }
</style>
