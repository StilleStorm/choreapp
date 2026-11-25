<script lang="ts">
  import type { InviteDto, InviteSummaryDto, Role } from '@choreapp/shared';
  import { api } from '../api.js';
  import { errorMessage } from '../messages.js';
  import { session } from '../session.svelte.js';
  import QrCode from './QrCode.svelte';
  import Sheet from './Sheet.svelte';

  let {
    open = $bindable(false),
    role,
    memberId = null,
    memberName = null,
  }: { open?: boolean; role: Role; memberId?: string | null; memberName?: string | null } = $props();

  let invite = $state<InviteDto | null>(null);
  let error = $state('');
  let now = $state(Date.now());
  let done = $state(false);

  const kind = $derived(!memberId ? 'join' : role === 'child' ? 'reconnect' : 'reset');
  const title = $derived(
    kind === 'join' ? (role === 'child' ? 'Dodaj dziecko' : 'Dodaj rodzica') : kind === 'reconnect' ? `Nowy telefon: ${memberName}` : `Reset hasła: ${memberName}`,
  );
  const remaining = $derived(invite ? Math.max(0, invite.expiresAt - now) : 0);
  const expired = $derived(!!invite && remaining === 0);

  async function create() {
    error = '';
    done = false;
    invite = null;
    try {
      invite = await api.post<InviteDto>('/v1/invites', { role, ...(memberId ? { memberId } : {}) });
    } catch (e) {
      error = errorMessage(e);
    }
  }

  $effect(() => {
    if (!open) return;
    void create();
    const tick = setInterval(() => (now = Date.now()), 1000);
    // Notice when the other phone has used the code.
    const poll = setInterval(async () => {
      if (!invite || done || Date.now() > invite.expiresAt) return;
      try {
        const pending = await api.get<InviteSummaryDto[]>('/v1/invites');
        if (invite && !pending.some((p) => p.id === invite!.id)) {
          done = true;
          await session.refresh();
        }
      } catch {
        /* offline: keep showing the code */
      }
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  });

  function fmt(ms: number): string {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

<Sheet bind:open {title}>
  {#if done}
    <div class="done">
      <div class="tick" aria-hidden="true">✓</div>
      <p><strong>Gotowe!</strong></p>
      <p class="muted">
        {kind === 'join' ? 'Nowa osoba dołączyła do rodziny.' : kind === 'reconnect' ? 'Nowy telefon jest połączony.' : 'Hasło zostało zmienione.'}
      </p>
      <button class="btn primary block" onclick={() => (open = false)}>Zamknij</button>
    </div>
  {:else if invite}
    <p class="muted small center">
      {#if kind === 'join' && role === 'child'}Na telefonie dziecka otwórz aplikację, wybierz „Mam kod od rodzica” i zeskanuj kod albo wpisz cyfry.{/if}
      {#if kind === 'join' && role === 'parent'}Drugi rodzic wybiera „Mam kod od rodzica”, a potem ustawia swój e-mail i hasło.{/if}
      {#if kind === 'reconnect'}Na nowym telefonie wybierz „Mam kod od rodzica”. Stary telefon zostanie wylogowany, punkty zostają.{/if}
      {#if kind === 'reset'}Na swoim telefonie {memberName} wybiera „Mam kod od rodzica” i ustawia nowe hasło.{/if}
    </p>
    <div class:faded={expired}>
      <QrCode value={invite.qr} size={232} />
    </div>
    <div class="code" aria-label="Kod">{invite.code.slice(0, 3)} {invite.code.slice(3)}</div>
    {#if expired}
      <p class="center">Kod wygasł.</p>
      <button class="btn primary block" onclick={create}>Nowy kod</button>
    {:else}
      <p class="center muted small">Ważny jeszcze {fmt(remaining)} · jednorazowy</p>
    {/if}
  {:else if error}
    <div class="error-box">{error}</div>
    <button class="btn block" onclick={create}>Spróbuj ponownie</button>
  {:else}
    <p class="center muted">Tworzenie kodu…</p>
  {/if}
</Sheet>

<style>
  .code {
    text-align: center;
    font-size: 2.2rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    font-variant-numeric: tabular-nums;
  }
  .faded {
    opacity: 0.25;
  }
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
    padding: 12px 0;
  }
  .tick {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: var(--success-soft);
    color: var(--success);
    font-size: 2.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
