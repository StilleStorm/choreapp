<script lang="ts">
  import type { InviteInfoDto, SessionDto } from '@choreapp/shared';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
  import AvatarPicker from '#lib/components/AvatarPicker.svelte';
  import BackHeader from '#lib/components/BackHeader.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { inviteTokenFrom, isNative, scanQr } from '#lib/native.js';
  import { session } from '#lib/session.svelte.js';

  let ref = $state<{ token?: string; code?: string } | null>(null);
  let info = $state<InviteInfoDto | null>(null);
  let code = $state('');
  let name = $state('');
  let email = $state('');
  let password = $state('');
  let avatar = $state<Blob | null>(null);
  let error = $state('');
  let busy = $state(false);

  $effect(() => {
    const t = page.url.searchParams.get('t');
    if (t && !ref) void inspect({ token: t });
  });

  async function inspect(r: { token?: string; code?: string }) {
    error = '';
    busy = true;
    try {
      info = await api.post<InviteInfoDto>('/v1/invites/inspect', r, { public: true });
      ref = r;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function scan() {
    error = '';
    try {
      const text = await scanQr();
      if (!text) return;
      const token = inviteTokenFrom(text);
      if (!token) {
        error = 'To nie jest kod zaproszenia.';
        return;
      }
      await inspect({ token });
    } catch (e) {
      error =
        e instanceof Error && e.message === 'scanner_installing'
          ? 'Telefon pobiera skaner kodów. Spróbuj ponownie za chwilę albo wpisz 6 cyfr.'
          : 'Nie udało się uruchomić skanera. Wpisz 6 cyfr z ekranu rodzica.';
    }
  }

  function submitCode(e: SubmitEvent) {
    e.preventDefault();
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      error = 'Kod ma 6 cyfr.';
      return;
    }
    void inspect({ code: digits });
  }

  async function redeem(e: SubmitEvent) {
    e.preventDefault();
    if (!ref || !info) return;
    error = '';
    if ((info.kind === 'reset' || (info.kind === 'join' && info.role === 'parent')) && password.length < 8) {
      error = 'Hasło musi mieć co najmniej 8 znaków.';
      return;
    }
    busy = true;
    try {
      const s = await api.post<SessionDto>(
        '/v1/invites/redeem',
        {
          ...ref,
          ...(info.kind === 'join' ? { name } : {}),
          ...(info.kind === 'join' && info.role === 'parent' ? { email, password } : {}),
          ...(info.kind === 'reset' ? { password } : {}),
        },
        { public: true },
      );
      await session.signIn(s);
      if (avatar) {
        try {
          await api.upload('/v1/me/avatar', avatar);
          await session.refresh();
        } catch {
          // Joining worked; the photo can be added later in the profile.
        }
      }
      await goto(session.home(), { replaceState: true });
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen no-tabs">
  <BackHeader title={info ? (info.kind === 'reset' ? 'Nowe hasło' : 'Witaj!') : 'Dołącz do rodziny'} back="/welcome" />

  {#if !info}
    <p class="muted">Rodzic pokazuje kod QR i 6 cyfr w swojej aplikacji: Ustawienia → Dodaj dziecko.</p>
    {#if isNative}
      <button class="btn primary block big" onclick={scan} disabled={busy}>
        <Icon name="qr" size={28} /> Zeskanuj kod QR
      </button>
      <p class="center muted small">albo wpisz kod</p>
    {/if}
    <form class="stack" onsubmit={submitCode}>
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
      <button class="btn block" class:primary={!isNative} disabled={busy}>Dalej</button>
    </form>
  {:else}
    <div class="card family">
      <span class="muted small">Rodzina</span>
      <strong>{info.familyName}</strong>
    </div>

    <form class="stack" onsubmit={redeem}>
      {#if info.kind === 'join' && info.role === 'child'}
        <label class="field">
          <span>Jak masz na imię?</span>
          <input type="text" bind:value={name} required maxlength="40" autocomplete="given-name" />
        </label>
        <div class="field">
          <span>Twoje zdjęcie (możesz dodać później)</span>
          <AvatarPicker name={name || '?'} bind:blob={avatar} />
        </div>
      {:else if info.kind === 'join'}
        <p class="muted">Dołączasz jako rodzic. Będziesz logować się e-mailem i hasłem.</p>
        <label class="field">
          <span>Twoje imię</span>
          <input type="text" bind:value={name} required maxlength="40" />
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
      {:else if info.kind === 'reconnect'}
        <p>Cześć, <strong>{info.memberName}</strong>! Ten telefon zostanie połączony z Twoim profilem. Punkty i naklejki zostają.</p>
        <p class="muted small">Stary telefon zostanie wylogowany.</p>
      {:else}
        <p>Ustaw nowe hasło dla: <strong>{info.memberName}</strong>.</p>
        <label class="field">
          <span>Nowe hasło</span>
          <input type="password" bind:value={password} required minlength="8" autocomplete="new-password" />
        </label>
      {/if}
      {#if error}<div class="error-box" role="alert">{error}</div>{/if}
      <button class="btn primary block" disabled={busy}>
        {busy ? 'Chwileczkę…' : info.kind === 'reset' ? 'Zapisz hasło' : info.kind === 'reconnect' ? 'Połącz telefon' : 'Dołącz'}
      </button>
    </form>
  {/if}

  {#if error && !info}<div class="error-box" role="alert">{error}</div>{/if}
</main>

<style>
  .big {
    min-height: 72px;
    font-size: 1.15rem;
  }
  .code-input {
    text-align: center;
    font-size: 2rem;
    letter-spacing: 0.3em;
    font-variant-numeric: tabular-nums;
    min-height: 64px;
  }
  .family {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
</style>
