<script lang="ts">
  import type { LicenseDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  let list = $state<LicenseDto[]>([]);
  let error = $state('');
  $effect(() => {
    api
      .get<LicenseDto[]>('/v1/licenses')
      .then((l) => (list = l))
      .catch((e) => (error = errorMessage(e)));
  });
</script>

<main class="screen no-tabs">
  <BackHeader title="Licencje grafik" back="/about" />
  <p class="muted small">
    Wszystkie grafiki w aplikacji pochodzą ze źródeł, które pozwalają ich używać, albo są naszymi własnymi grafikami. Część
    naklejek, awatarów i ramek to oryginalne ilustracje wygenerowane z pomocą AI dla Stille Storm Studio: nie przedstawiają postaci
    ani znaków z istniejących bajek, gier czy filmów. Oto skąd są:
  </p>
  {#if error}<div class="error-box">{error}</div>{/if}
  <div class="list">
    {#each list as l (l.pack)}
      <div class="row lic">
        <strong>{l.pack}</strong>
        <span class="small">Licencja: {l.license === 'private' ? 'prywatna (własne grafiki)' : l.license}</span>
        {#if l.attribution}<span class="small muted">{l.attribution}</span>{/if}
        {#if session.isParent && l.source.startsWith('http')}<a class="small" href={l.source} target="_blank" rel="noopener">{l.source}</a>{:else}<span class="small muted">{l.source}</span>{/if}
      </div>
    {/each}
  </div>
</main>

<style>
  .lic {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .lic a {
    word-break: break-all;
  }
</style>
