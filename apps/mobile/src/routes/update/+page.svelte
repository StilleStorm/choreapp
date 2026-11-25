<script lang="ts">
  import BackHeader from '#lib/components/BackHeader.svelte';
  import { session } from '#lib/session.svelte.js';
  import { selfUpdates, update } from '#lib/update.svelte.js';

  $effect(() => {
    void update.check();
  });
</script>

<main class="screen no-tabs">
  <BackHeader title="Aktualizacja" back={session.home()} />
  <div class="card stack">
    <p>Zainstalowana wersja: <strong>{update.installed.name}</strong></p>
    {#if !selfUpdates}
      <p class="muted">Aktualizacje przychodzą ze sklepu Google Play.</p>
    {:else if update.latest}
      <p>Najnowsza wersja: <strong>{update.latest.versionName}</strong></p>
      {#if update.latest.notes}<p class="muted">{update.latest.notes}</p>{/if}
      {#if update.available}
        <a class="btn primary block" href={update.latest.url} target="_blank" rel="noopener">Pobierz nową wersję</a>
        <p class="muted small">
          Po pobraniu otwórz plik i zainstaluj. Telefon może zapytać o zgodę na instalację z tego źródła. Twoje punkty i
          naklejki zostają.
        </p>
      {:else}
        <p class="success-text">Masz najnowszą wersję.</p>
      {/if}
    {:else}
      <p class="muted">Brak informacji o nowszej wersji.</p>
    {/if}
  </div>
</main>

<style>
  .success-text {
    color: var(--success);
    font-weight: 700;
  }
</style>
