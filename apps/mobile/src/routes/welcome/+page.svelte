<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { leaveIfSignedIn } from '#lib/guards.svelte.js';

  leaveIfSignedIn();
</script>

<main class="screen no-tabs welcome">
  <div class="hero">
    <div class="logo" aria-hidden="true">
      <Icon name="star" size={44} stroke={2.2} />
    </div>
    <h1>Rodzinne zadania</h1>
    <p class="muted">Zadania dla dzieci, punkty, naklejki i nagrody.</p>
  </div>

  <div class="stack">
    <a class="btn primary block" href="/join">
      <Icon name="qr" /> Mam kod od rodzica
    </a>
    <a class="btn block" href="/login">Zaloguj się jako rodzic</a>
    <a class="btn ghost block" href="/register">Załóż nową rodzinę</a>
  </div>
</main>

<style>
  .welcome {
    justify-content: space-between;
    padding-top: calc(var(--safe-top) + 15vh);
  }
  .hero {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .logo {
    width: 88px;
    height: 88px;
    border-radius: 28px;
    background: var(--accent);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
  }
</style>
