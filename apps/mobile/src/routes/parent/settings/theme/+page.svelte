<script lang="ts">
  import BackHeader from '#lib/components/BackHeader.svelte';
  import ThemePicker from '#lib/components/ThemePicker.svelte';
  import { ADULT_THEMES } from '#lib/themes/pickable.js';
</script>

<main class="screen">
  <BackHeader title="Wygląd aplikacji" back="/parent/settings" />
  <p class="muted">Motyw widzisz tylko Ty, na każdym telefonie, na którym się zalogujesz.</p>
  <ThemePicker themes={ADULT_THEMES} buttonLabel={() => 'Zatwierdź'} />
</main>
