<script lang="ts">
  import BackHeader from '#lib/components/BackHeader.svelte';
  import { session } from '#lib/session.svelte.js';
  import { selfUpdates, update } from '#lib/update.svelte.js';
  import { AppUpdater, updaterError } from '#lib/updater.js';

  /**
   * The app downloads the new APK itself (no browser, no links out, also for
   * children), checks it and opens the system installer.
   */
  type Step = 'idle' | 'downloading' | 'permission' | 'ready' | 'error';
  let step = $state<Step>('idle');
  let progress = $state(0);
  let total = $state(0);
  let error = $state('');

  $effect(() => {
    void update.check();
  });

  // Back from the system settings: carry on if installing is now allowed.
  $effect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== 'visible' || step !== 'permission') return;
      const { granted } = await AppUpdater.canInstall();
      if (granted) await install();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  const mb = (n: number) => `${(n / 1_048_576).toFixed(1).replace('.', ',')} MB`;
  const percent = $derived(total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0);

  async function start() {
    const latest = update.latest;
    if (!latest || step === 'downloading') return;
    step = 'downloading';
    error = '';
    progress = 0;
    total = latest.size ?? 0;
    const sub = await AppUpdater.addListener('progress', (p) => {
      progress = p.downloaded;
      if (p.total > 0) total = p.total;
    });
    try {
      await AppUpdater.download({ url: latest.url, size: latest.size ?? undefined, sha256: latest.sha256 ?? undefined });
      await install();
    } catch (e) {
      error = updaterError(e);
      step = 'error';
    } finally {
      await sub.remove();
    }
  }

  async function install() {
    const { granted } = await AppUpdater.canInstall();
    if (!granted) {
      step = 'permission';
      return;
    }
    step = 'ready';
    try {
      await AppUpdater.install();
    } catch (e) {
      error = updaterError(e);
      step = 'error';
    }
  }
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
        {#if step === 'idle' || step === 'error'}
          {#if error}<div class="error-box">{error}</div>{/if}
          <button class="btn primary block" onclick={start}>{step === 'error' ? 'Spróbuj ponownie' : 'Pobierz i zainstaluj'}</button>
          <p class="muted small">
            Aplikacja sama pobierze nową wersję{update.latest.size ? ` (${mb(update.latest.size)})` : ''} i otworzy instalator. Twoje
            punkty i naklejki zostają.
          </p>
        {:else if step === 'downloading'}
          <p>Pobieranie… {percent}%</p>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
            <span style:width="{percent}%"></span>
          </div>
          {#if total > 0}<p class="muted small">{mb(progress)} z {mb(total)}</p>{/if}
        {:else if step === 'permission'}
          <p><strong>Jeszcze jedna zgoda</strong></p>
          <p>
            Telefon pyta, czy ta aplikacja może instalować swoje aktualizacje. Otworzymy ustawienia: włącz
            <strong>„Zezwalaj z tego źródła”</strong> i wróć tutaj (strzałką wstecz).
          </p>
          {#if !session.isParent}<p class="muted small">Jeśli nie wiesz, jak to zrobić, poproś rodzica.</p>{/if}
          <button class="btn primary block" onclick={() => AppUpdater.openInstallSettings()}>Otwórz ustawienia</button>
          <button class="btn ghost block" onclick={install}>Już włączone, instaluj</button>
        {:else if step === 'ready'}
          <p class="success-text">Pobrane i sprawdzone.</p>
          <p class="muted small">W okienku telefonu wybierz „Zainstaluj” (lub „Aktualizuj”).</p>
          <button class="btn primary block" onclick={install}>Zainstaluj</button>
        {/if}
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
  .bar {
    height: 12px;
    border-radius: 999px;
    background: var(--surface-2, rgba(127, 127, 127, 0.2));
    overflow: hidden;
  }
  .bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
</style>
