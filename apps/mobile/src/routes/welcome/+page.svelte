<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { leaveIfSignedIn } from '#lib/guards.svelte.js';

  leaveIfSignedIn();
</script>

<main class="screen no-tabs welcome">
  <div class="hero">
    <img class="logo" src="/logo.png" alt="" width="104" height="104" />
    <h1>Zadania</h1>
    <p class="tagline">rodzinne misje</p>
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
    width: 104px;
    height: 104px;
    border-radius: 28px;
    margin-bottom: 8px;
  }
  h1 {
    margin-bottom: 0;
  }
  .tagline {
    margin: -6px 0 4px;
    font-weight: 700;
    color: #f08a1c;
  }
</style>
