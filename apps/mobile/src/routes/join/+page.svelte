<script lang="ts">
  import type { InviteInfoDto, SessionDto } from '@choreapp/shared';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
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
  let password2 = $state('');
  let error = $state('');
  let busy = $state(false);
  /** A child already logged in is adding another home (mum's, dad's, grandparents'). */
  const addingHome = !!session.me && !session.isParent;
  // Logged in and not here on purpose ("Dodaj kolejny dom" or a scanned QR link), e.g. Back from home.
  if (session.me && !page.url.searchParams.has('add') && !page.url.searchParams.has('t')) {
    void goto(session.home(), { replace: true });
  }
  /** Joining a family this phone is already in makes a second, empty profile there. */
  const alreadyHere = $derived(info?.kind === 'join' && session.homes.list.some((h) => h.familyName === info!.familyName));

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
    if ((info.kind === 'reset' || (info.kind === 'join' && info.role === 'parent')) && password !== password2) {
      error = 'Hasła nie są takie same.';
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
      await goto(session.home(), { replace: true });
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen no-tabs">
  <BackHeader title={info ? (info.kind === 'reset' ? 'Nowe hasło' : 'Witaj!') : addingHome ? 'Dodaj kolejny dom' : 'Dołącz do rodziny'} back={addingHome ? '/child/profile' : '/welcome'} />

  {#if !info}
    {#if addingHome}
      <p class="muted">Dodajesz kolejny dom. Poproś dorosłego z tamtego domu o kod: Ustawienia → Dodaj dziecko. Twój obecny dom zostaje na telefonie.</p>
    {:else}
      <p class="muted">Rodzic pokazuje kod QR i 6 cyfr w swojej aplikacji: Ustawienia → Dodaj dziecko.</p>
    {/if}
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
    {#if alreadyHere}
      <p class="error-box">
        Ten telefon jest już w domu „{info.familyName}”. Dołączenie utworzy tam nowy, pusty profil. Żeby zachować punkty, poproś rodzica o
        kod „Połącz na nowym telefonie”.
      </p>
    {/if}

    <form class="stack" onsubmit={redeem}>
      {#if info.kind === 'join' && info.role === 'child'}
        <label class="field">
          <span>Jak mam Cię nazywać?</span>
          <input type="text" bind:value={name} required maxlength="40" autocomplete="off" />
          <span class="hint muted small">Może być pseudonim. Nie wpisuj nazwiska.</span>
        </label>
        <p class="muted small">Awatar i ramkę wybierzesz potem w Profilu.</p>
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
        <label class="field">
          <span>Powtórz hasło</span>
          <input type="password" bind:value={password2} required minlength="8" autocomplete="new-password" />
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
        <label class="field">
          <span>Powtórz nowe hasło</span>
          <input type="password" bind:value={password2} required minlength="8" autocomplete="new-password" />
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
