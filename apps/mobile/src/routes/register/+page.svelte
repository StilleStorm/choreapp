<script lang="ts">
  import type { SessionDto } from '@choreapp/shared';
  import { goto } from '$app/navigation';
  import { api, PRIVACY_URL } from '#lib/api.js';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';
  import { leaveIfSignedIn } from '#lib/guards.svelte.js';

  leaveIfSignedIn();

  let familyName = $state('');
  let parentName = $state('');
  let email = $state('');
  let password = $state('');
  let password2 = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
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
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Warsaw';
      const s = await api.post<SessionDto>('/v1/auth/register', { familyName, parentName, email, password, timezone }, { public: true });
      await session.signIn(s);
      await goto('/parent', { replace: true });
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen no-tabs auth">
  <BackHeader title="Nowa rodzina" back="/welcome" />
  <p class="muted">Zakładasz rodzinę jako pierwszy rodzic. Drugiego rodzica i dzieci zaprosisz kodem QR.</p>
  <form class="stack" onsubmit={submit}>
    <label class="field">
      <span>Nazwa rodziny</span>
      <input type="text" bind:value={familyName} placeholder="np. Kowalscy" required maxlength="40" />
    </label>
    <label class="field">
      <span>Twoje imię</span>
      <input type="text" bind:value={parentName} placeholder="np. Mama" required maxlength="40" autocomplete="given-name" />
    </label>
    <label class="field">
      <span>E-mail</span>
      <input type="email" bind:value={email} required autocomplete="email" />
    </label>
    <label class="field">
      <span>Hasło</span>
      <input type="password" bind:value={password} required minlength="8" autocomplete="new-password" />
      <span class="hint">Co najmniej 8 znaków.</span>
    </label>
    <label class="field">
      <span>Powtórz hasło</span>
      <input type="password" bind:value={password2} required minlength="8" autocomplete="new-password" />
    </label>
    {#if error}<div class="error-box" role="alert">{error}</div>{/if}
    <button class="btn primary block" disabled={busy}>{busy ? 'Zakładanie…' : 'Załóż rodzinę'}</button>
    <p class="muted small">
      Zakładając rodzinę, potwierdzasz, że znasz <a href={PRIVACY_URL} target="_blank" rel="noopener">politykę prywatności</a>.
    </p>
  </form>
</main>
