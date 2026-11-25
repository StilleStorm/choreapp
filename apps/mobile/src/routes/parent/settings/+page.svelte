<script lang="ts">
  import type { FamilyDto, MemberDto, Role } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import AvatarPicker from '#lib/components/AvatarPicker.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import InviteSheet from '#lib/components/InviteSheet.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  // Invite sheet
  let inviteOpen = $state(false);
  let inviteRole = $state<Role>('child');
  let inviteMember = $state<MemberDto | null>(null);
  function openInvite(role: Role, member: MemberDto | null = null) {
    inviteRole = role;
    inviteMember = member;
    memberOpen = false;
    inviteOpen = true;
  }

  // Member sheet
  let memberOpen = $state(false);
  let selected = $state<MemberDto | null>(null);
  let editName = $state('');
  let avatarBlob = $state<Blob | null>(null);
  let memberError = $state('');
  let confirmRemove = $state(false);
  function openMember(m: MemberDto) {
    selected = m;
    editName = m.name;
    avatarBlob = null;
    memberError = '';
    confirmRemove = false;
    memberOpen = true;
  }
  const isMe = $derived(selected?.id === session.me?.id);
  /** Children are everyone's; other adults are managed by the family administrator. */
  const canEdit = $derived(isMe || selected?.role === 'child' || session.isAdmin);

  async function saveMember() {
    if (!selected) return;
    memberError = '';
    try {
      if (editName.trim() && editName.trim() !== selected.name) {
        if (isMe) await api.patch('/v1/me', { name: editName.trim() });
        else await api.patch(`/v1/members/${selected.id}`, { name: editName.trim() });
      }
      if (isMe && avatarBlob) await api.upload('/v1/me/avatar', avatarBlob);
      await session.refresh();
      memberOpen = false;
    } catch (e) {
      memberError = errorMessage(e);
    }
  }

  async function removeMember() {
    if (!selected) return;
    try {
      await api.del(`/v1/members/${selected.id}`);
      await session.refresh();
      memberOpen = false;
    } catch (e) {
      memberError = errorMessage(e);
    }
  }

  // Own login (e-mail, password)
  let loginOpen = $state(false);
  let loginKind = $state<'email' | 'password'>('email');
  let currentPassword = $state('');
  let newEmail = $state('');
  let newPassword = $state('');
  let loginError = $state('');
  let loginBusy = $state(false);
  let loginDone = $state('');
  function openLogin(what: 'email' | 'password') {
    currentPassword = '';
    newEmail = what === 'email' ? (session.me?.email ?? '') : '';
    newPassword = '';
    loginError = '';
    loginDone = '';
    loginKind = what;
    loginOpen = true;
  }

  async function saveLogin(e: SubmitEvent) {
    e.preventDefault();
    loginError = '';
    if (loginKind === 'password' && newPassword.length < 8) {
      loginError = 'Hasło musi mieć co najmniej 8 znaków.';
      return;
    }
    loginBusy = true;
    try {
      if (loginKind === 'email') {
        await api.post('/v1/me/email', { currentPassword, newEmail: newEmail.trim() });
        await session.refresh();
        loginDone = 'E-mail został zmieniony.';
      } else {
        await api.post('/v1/me/password', { currentPassword, newPassword });
        loginDone = 'Hasło zostało zmienione. Inne telefony zostały wylogowane.';
      }
    } catch (err) {
      loginError = errorMessage(err);
    } finally {
      loginBusy = false;
    }
  }

  // Family settings
  const f = session.family!;
  let familyName = $state(f.name);
  let quietFrom = $state(f.quietFrom);
  let quietTo = $state(f.quietTo);
  let reminderTime = $state(f.reminderTime);
  let quietEnabled = $state(f.quietFrom !== f.quietTo);
  let saving = $state(false);
  let saved = $state(false);
  let settingsError = $state('');

  async function saveSettings(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    saved = false;
    settingsError = '';
    try {
      await api.patch<FamilyDto>('/v1/family', {
        name: familyName.trim(),
        quietFrom: quietEnabled ? quietFrom : '00:00',
        quietTo: quietEnabled ? quietTo : '00:00',
        reminderTime,
      });
      await session.refresh();
      saved = true;
    } catch (err) {
      settingsError = errorMessage(err);
    } finally {
      saving = false;
    }
  }
</script>

<main class="screen">
  <header class="screen-header">
    <div>
      <h1>Ustawienia</h1>
      <p class="sub">Rodzina {session.family?.name}</p>
    </div>
  </header>

  <section class="section">
    <h2 class="section-title">Dzieci</h2>
    <div class="list">
      {#each session.children as m (m.id)}
        <button class="row member" onclick={() => openMember(m)}>
          <Avatar name={m.name} url={m.avatarUrl} frameUrl={m.frameUrl} />
          <span class="grow">
            <span class="title">{m.name}</span>
            <span class="meta">{m.connected ? 'Telefon połączony' : 'Brak połączonego telefonu'}</span>
          </span>
          <Icon name="chevron" size={20} />
        </button>
      {:else}
        <p class="empty">Nie ma jeszcze dzieci. Dodaj pierwsze kodem QR.</p>
      {/each}
    </div>
    <button class="btn primary block" onclick={() => openInvite('child')}><Icon name="plus" /> Dodaj dziecko</button>
  </section>

  <section class="section">
    <h2 class="section-title">Rodzice i opiekunowie</h2>
    <div class="list">
      {#each session.parents as m (m.id)}
        <button class="row member" onclick={() => openMember(m)}>
          <Avatar name={m.name} url={m.avatarUrl} />
          <span class="grow">
            <span class="title">{m.name}{m.id === session.me?.id ? ' (Ty)' : ''}</span>
            <span class="meta">{m.id === session.family?.adminMemberId ? 'Administrator' : ''}{m.id === session.family?.adminMemberId && m.email ? ' · ' : ''}{m.email ?? ''}</span>
          </span>
          <Icon name="chevron" size={20} />
        </button>
      {/each}
    </div>
    <button class="btn block" onclick={() => openInvite('parent')}><Icon name="plus" /> Dodaj rodzica lub opiekuna</button>
  </section>

  {#if session.isAdmin}
    <form class="section" onsubmit={saveSettings}>
      <h2 class="section-title">Rodzina i powiadomienia</h2>
      <div class="card stack">
        <label class="field">
          <span>Nazwa rodziny</span>
          <input type="text" bind:value={familyName} maxlength="40" required />
        </label>
        <label class="field">
          <span>Codzienne przypomnienie o zadaniach</span>
          <input type="time" bind:value={reminderTime} required />
          <span class="hint">Dzieci z niezrobionymi zadaniami dostaną jedno przypomnienie dziennie.</span>
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={quietEnabled} />
          <span>Godziny ciszy</span>
        </label>
        {#if quietEnabled}
          <div class="inline times">
            <label class="field"><span>Od</span><input type="time" bind:value={quietFrom} required /></label>
            <label class="field"><span>Do</span><input type="time" bind:value={quietTo} required /></label>
          </div>
          <span class="hint muted small">W tych godzinach nikt nie dostaje powiadomień. Wstrzymane przyjdą rano jako jedno zbiorcze.</span>
        {/if}
        {#if settingsError}<div class="error-box">{settingsError}</div>{/if}
        <button class="btn primary" disabled={saving}>{saving ? 'Zapisywanie…' : saved ? 'Zapisano ✓' : 'Zapisz'}</button>
      </div>
    </form>
  {/if}

  <section class="section">
    <h2 class="section-title">Konto</h2>
    <div class="list">
      <button class="row member" onclick={() => openLogin('email')}>
        <Icon name="edit" />
        <span class="grow">
          <span class="title">Zmień e-mail</span>
          {#if session.me?.email}<span class="meta">{session.me.email}</span>{/if}
        </span>
        <Icon name="chevron" size={20} />
      </button>
      <button class="row member" onclick={() => openLogin('password')}>
        <Icon name="key" />
        <span class="grow title">Zmień hasło</span>
        <Icon name="chevron" size={20} />
      </button>
      <a class="row member" href="/update">
        <Icon name="download" />
        <span class="grow title">Wersja aplikacji</span>
        <Icon name="chevron" size={20} />
      </a>
      <a class="row member" href="/licenses">
        <Icon name="info" />
        <span class="grow title">Licencje grafik</span>
        <Icon name="chevron" size={20} />
      </a>
      <button class="row member" onclick={() => session.signOut()}>
        <Icon name="logout" />
        <span class="grow title">Wyloguj się</span>
      </button>
    </div>
  </section>
</main>

<InviteSheet bind:open={inviteOpen} role={inviteRole} memberId={inviteMember?.id ?? null} memberName={inviteMember?.name ?? null} />

<Sheet bind:open={memberOpen} title={selected?.name}>
  {#if selected}
    {#if isMe}
      <AvatarPicker name={editName || selected.name} currentUrl={selected.avatarUrl} bind:blob={avatarBlob} />
    {/if}
    {#if canEdit}
      <label class="field">
        <span>{selected.role === 'child' ? 'Nazwa' : 'Imię'}</span>
        <input type="text" bind:value={editName} maxlength="40" autocomplete="off" />
        {#if selected.role === 'child'}<span class="hint muted small">Może być pseudonim. Nie wpisuj nazwiska.</span>{/if}
      </label>
      <button class="btn primary block" onclick={saveMember}>Zapisz</button>
    {:else}
      <p class="hint muted small">Profile innych dorosłych zmienia administrator rodziny.</p>
    {/if}
    {#if memberError}<div class="error-box">{memberError}</div>{/if}

    {#if selected.role === 'child'}
      <button class="btn block" onclick={() => openInvite('child', selected)}>
        <Icon name="phone" /> Połącz na nowym telefonie
      </button>
      <p class="hint muted small">Dziecko zachowa punkty, naklejki i historię. Stary telefon zostanie wylogowany.</p>
    {:else if !isMe && session.isAdmin}
      <button class="btn block" onclick={() => openInvite('parent', selected)}>
        <Icon name="key" /> Kod do zmiany hasła
      </button>
    {/if}

    {#if !isMe && session.isAdmin}
      {#if confirmRemove}
        <div class="error-box">
          {selected.name} straci dostęp, a telefon zostanie wylogowany. Historia zadań i punktów zostaje.
        </div>
        <div class="inline">
          <button class="btn grow" onclick={() => (confirmRemove = false)}>Anuluj</button>
          <button class="btn danger grow" onclick={removeMember}>Usuń z rodziny</button>
        </div>
      {:else}
        <button class="btn ghost block danger-text" onclick={() => (confirmRemove = true)}>
          <Icon name="trash" size={20} /> Usuń z rodziny
        </button>
      {/if}
    {/if}
  {/if}
</Sheet>

<Sheet bind:open={loginOpen} title={loginKind === 'email' ? 'Zmień e-mail' : 'Zmień hasło'}>
  {#if loginDone}
    <p>{loginDone}</p>
    <button class="btn primary block" onclick={() => (loginOpen = false)}>Zamknij</button>
  {:else}
    <form class="stack" onsubmit={saveLogin}>
      {#if loginKind === 'email'}
        <label class="field">
          <span>Nowy e-mail</span>
          <input type="email" bind:value={newEmail} required autocomplete="email" />
        </label>
      {:else}
        <label class="field">
          <span>Nowe hasło</span>
          <input type="password" bind:value={newPassword} required minlength="8" autocomplete="new-password" />
          <span class="hint">Co najmniej 8 znaków. Inne telefony zostaną wylogowane.</span>
        </label>
      {/if}
      <label class="field">
        <span>Obecne hasło</span>
        <input type="password" bind:value={currentPassword} required autocomplete="current-password" />
      </label>
      {#if loginError}<div class="error-box" role="alert">{loginError}</div>{/if}
      <button class="btn primary block" disabled={loginBusy}>{loginBusy ? 'Zapisywanie…' : 'Zapisz'}</button>
    </form>
  {/if}
</Sheet>

<style>
  .member {
    appearance: none;
    border: 0;
    background: none;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .member .grow {
    display: flex;
    flex-direction: column;
  }
  .times {
    flex-wrap: nowrap;
  }
  .times .field {
    flex: 1;
  }
  .grow {
    flex: 1;
  }
  .danger-text {
    color: var(--danger);
  }
</style>
