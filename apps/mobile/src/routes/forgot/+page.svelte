<script lang="ts">
  import type { SessionDto } from '@choreapp/shared';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  let step = $state<'email' | 'code'>('email');
  let email = $state(page.url.searchParams.get('email') ?? '');
  let code = $state('');
  let password = $state('');
  let password2 = $state('');
  let error = $state('');
  let busy = $state(false);

  async function sendCode(e?: SubmitEvent) {
    e?.preventDefault();
    error = '';
    busy = true;
    try {
      await api.post('/v1/auth/forgot', { email }, { public: true });
      step = 'code';
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function reset(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      error = 'Kod ma 6 cyfr.';
      return;
    }
    if (password.length < 8) {
      error = 'Hasło musi mieć co najmniej 8 znaków.';
      return;
    }
    if (password !== password2) {
      error = 'Hasła nie są takie same.';
      return;
    }
    busy = true;
    try {
      const s = await api.post<SessionDto>('/v1/auth/reset', { email, code: digits, newPassword: password }, { public: true });
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
  <BackHeader title="Nie pamiętam hasła" back="/login" />

  {#if step === 'email'}
    <p class="muted">Podaj e-mail, którym logujesz się do aplikacji. Wyślemy na niego kod do zmiany hasła.</p>
    <form class="stack" onsubmit={sendCode}>
      <label class="field">
        <span>E-mail</span>
        <input type="email" bind:value={email} required autocomplete="email" />
      </label>
      {#if error}<div class="error-box" role="alert">{error}</div>{/if}
      <button class="btn primary block" disabled={busy}>{busy ? 'Wysyłanie…' : 'Wyślij kod'}</button>
    </form>
  {:else}
    <p>
      Jeśli <strong>{email}</strong> ma konto, za chwilę przyjdzie na niego 6-cyfrowy kod. Kod jest ważny 15 minut.
    </p>
    <form class="stack" onsubmit={reset}>
      <input
        class="code-input"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="7"
        placeholder="000 000"
        bind:value={code}
        aria-label="Kod z 6 cyfr"
      />
      <label class="field">
        <span>Nowe hasło</span>
        <input type="password" bind:value={password} required minlength="8" autocomplete="new-password" />
        <span class="hint">Co najmniej 8 znaków.</span>
      </label>
      <label class="field">
        <span>Powtórz nowe hasło</span>
        <input type="password" bind:value={password2} required minlength="8" autocomplete="new-password" />
      </label>
      {#if error}<div class="error-box" role="alert">{error}</div>{/if}
      <button class="btn primary block" disabled={busy}>{busy ? 'Chwileczkę…' : 'Zmień hasło i zaloguj'}</button>
    </form>
    <button class="btn ghost block" type="button" onclick={() => sendCode()} disabled={busy}>Wyślij kod ponownie</button>
  {/if}

  <p class="muted small">Kod przyjdzie z adresu noreply@stillestormstudio.com. Sprawdź też spam.</p>
</main>

<style>
  .code-input {
    text-align: center;
    font-size: 2rem;
    letter-spacing: 0.3em;
    font-variant-numeric: tabular-nums;
    min-height: 64px;
  }
</style>
