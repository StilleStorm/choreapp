<script lang="ts">
  import BackHeader from '#lib/components/BackHeader.svelte';
  import ThemePicker from '#lib/components/ThemePicker.svelte';
  import { doneLabel } from '#lib/doneLabel.svelte.js';
  import { CHILD_THEMES } from '#lib/themes/pickable.js';
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

  <h2 class="section-title">Wybierz motyw</h2>
  <ThemePicker themes={CHILD_THEMES} buttonLabel={(t) => doneLabel.for(t.id)} />
</main>
