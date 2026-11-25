<script lang="ts">
  import type { SessionDto } from '@choreapp/shared';
  import { goto } from '$app/navigation';
  import { api } from '#lib/api.js';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      const s = await api.post<SessionDto>('/v1/auth/login', { email, password }, { public: true });
      await session.signIn(s);
      await goto(session.home(), { replaceState: true });
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen no-tabs">
  <BackHeader title="Logowanie rodzica" back="/welcome" />
  <form class="stack" onsubmit={submit}>
    <label class="field">
      <span>E-mail</span>
      <input type="email" bind:value={email} required autocomplete="email" />
    </label>
    <label class="field">
      <span>Hasło</span>
      <input type="password" bind:value={password} required autocomplete="current-password" />
    </label>
    {#if error}<div class="error-box" role="alert">{error}</div>{/if}
    <button class="btn primary block" disabled={busy}>{busy ? 'Logowanie…' : 'Zaloguj się'}</button>
  </form>
  <a class="btn ghost block" href={email ? `/forgot?email=${encodeURIComponent(email)}` : '/forgot'}>Nie pamiętam hasła</a>
  <p class="muted small">
    Kod do zmiany hasła przyjdzie e-mailem. Możesz też poprosić administratora rodziny o kod resetu w Ustawieniach i wybrać
    „Mam kod od rodzica”.
  </p>
</main>
