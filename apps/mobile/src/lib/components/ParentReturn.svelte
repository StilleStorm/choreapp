<script lang="ts">
  /**
   * "Wróć do rodzica": shown only while a child uses an adult's phone. Needs the
   * phone's own unlock (fingerprint/face or screen-lock PIN); a phone without a
   * screen lock asks for the adult's app password instead.
   */
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import { errorMessage } from '../messages.js';
  import { session } from '../session.svelte.js';
  import { unlockPhone } from '../unlock.js';

  let { prominent = false }: { prominent?: boolean } = $props();

  let busy = $state(false);
  let error = $state('');
  let passwordOpen = $state(false);
  let password = $state('');
  let passwordError = $state('');

  async function start() {
    error = '';
    busy = true;
    try {
      const r = await unlockPhone();
      if (r === 'ok') await session.returnToParent();
      else if (r === 'password') {
        password = '';
        passwordError = '';
        passwordOpen = true;
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function withPassword(e: SubmitEvent) {
    e.preventDefault();
    passwordError = '';
    busy = true;
    try {
      await session.verifyParentPassword(password);
      passwordOpen = false;
      await session.returnToParent();
    } catch (err) {
      passwordError = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if session.swapped}
  <button class="btn {prominent ? 'primary block' : 'ghost small'}" onclick={start} disabled={busy}>
    <Icon name="key" size={18} /> Wróć do rodzica
  </button>
  {#if error}<div class="error-box" role="alert">{error}</div>{/if}

  <Sheet bind:open={passwordOpen} title="Wróć do rodzica">
    <form class="stack" onsubmit={withPassword}>
      <p class="muted small">Ten telefon nie ma blokady ekranu, więc potrzebne jest hasło rodzica do aplikacji.</p>
      <label class="field">
        <span>Hasło rodzica</span>
        <input type="password" bind:value={password} required autocomplete="current-password" />
      </label>
      {#if passwordError}<div class="error-box" role="alert">{passwordError}</div>{/if}
      <div class="inline">
        <button type="button" class="btn grow" onclick={() => (passwordOpen = false)}>Anuluj</button>
        <button class="btn primary grow" disabled={busy || !password}>{busy ? 'Sprawdzanie…' : 'Wróć'}</button>
      </div>
    </form>
  </Sheet>
{/if}

<style>
  .grow {
    flex: 1;
  }
</style>
