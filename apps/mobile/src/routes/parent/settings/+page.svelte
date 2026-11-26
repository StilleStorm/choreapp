<script lang="ts">
  import { SUPPORT_URL, showSupport } from '#lib/support.js';
  import type { FamilyDto, ItemDto, MemberDto, Role } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import AvatarPicker from '#lib/components/AvatarPicker.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import InviteSheet from '#lib/components/InviteSheet.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import ThemeAvatarGrid from '#lib/components/ThemeAvatarGrid.svelte';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';
  import { ADULT_THEMES, NEUTRAL } from '#lib/themes/pickable.js';
  import { selfUpdates } from '#lib/update.svelte.js';

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

  // Theme avatars: adults may wear them too, instead of a photo.
  let avatarsOpen = $state(false);
  let themeAvatars = $state<ItemDto[]>([]);
  let avatarsError = $state('');
  async function openAvatars() {
    memberOpen = false;
    avatarsError = '';
    avatarsOpen = true;
    try {
      if (!themeAvatars.length) themeAvatars = await api.get<ItemDto[]>('/v1/avatars/themes');
    } catch (e) {
      avatarsError = errorMessage(e);
    }
  }
  async function wearAvatar(itemId: string | null) {
    avatarsError = '';
    try {
      await api.put('/v1/me/appearance', { avatarItemId: itemId, frameItemId: session.me?.frameItemId ?? null });
      await session.refresh();
      avatarsOpen = false;
    } catch (e) {
      avatarsError = errorMessage(e);
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
  let newPassword2 = $state('');
  let loginError = $state('');
  let loginBusy = $state(false);
  let loginDone = $state('');
  function openLogin(what: 'email' | 'password') {
    currentPassword = '';
    newEmail = what === 'email' ? (session.me?.email ?? '') : '';
    newPassword = '';
    newPassword2 = '';
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
    if (loginKind === 'password' && newPassword !== newPassword2) {
      loginError = 'Hasła nie są takie same.';
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

  /** Adults the administrator can hand the role to (the role is per family). */
  const otherAdults = $derived(session.parents.filter((m) => m.id !== session.me?.id));

  // Hand the administrator role to another adult
  let adminOpen = $state(false);
  let adminTarget = $state('');
  let adminPassword = $state('');
  let adminError = $state('');
  let adminBusy = $state(false);
  function openAdmin() {
    adminTarget = otherAdults[0]?.id ?? '';
    adminPassword = '';
    adminError = '';
    adminOpen = true;
  }
  async function transferAdmin(e: SubmitEvent) {
    e.preventDefault();
    adminError = '';
    adminBusy = true;
    try {
      await api.post('/v1/family/admin', { memberId: adminTarget, currentPassword: adminPassword });
      await session.refresh();
      adminOpen = false;
    } catch (err) {
      adminError = errorMessage(err);
    } finally {
      adminBusy = false;
    }
  }

  // An adult deletes their own account; the administrator can only delete the whole family
  // (or hand the role on first, in its own sheet, and then delete their account).
  let deleteOpen = $state(false);
  let deleteMode = $state<'me' | 'family'>('me');
  let deletePassword = $state('');
  let deleteConfirmName = $state('');
  const deleteNameOk = $derived(
    deleteMode !== 'family' || deleteConfirmName.trim().toLocaleLowerCase('pl') === (session.family?.name ?? '').trim().toLocaleLowerCase('pl'),
  );
  let deleteError = $state('');
  let deleteBusy = $state(false);
  function openDelete() {
    deleteMode = session.isAdmin ? 'family' : 'me';
    deletePassword = '';
    deleteConfirmName = '';
    deleteError = '';
    deleteOpen = true;
  }

  async function deleteAccount(e: SubmitEvent) {
    e.preventDefault();
    deleteError = '';
    deleteBusy = true;
    try {
      await api.post(deleteMode === 'family' ? '/v1/family/delete' : '/v1/me/delete', { currentPassword: deletePassword });
      deleteOpen = false;
      // The server has already ended every session.
      await session.signOut(false);
    } catch (err) {
      deleteError = errorMessage(err);
    } finally {
      deleteBusy = false;
    }
  }

  // A child without a phone uses this phone: switch into their account.
  let swapOpen = $state(false);
  let swapError = $state('');
  let swapBusy = $state('');
  function openSwap() {
    swapError = '';
    swapOpen = true;
  }
  async function swapTo(m: MemberDto) {
    swapError = '';
    swapBusy = m.id;
    try {
      await session.swapToChild(m.id);
      swapOpen = false;
    } catch (err) {
      swapError = errorMessage(err);
    } finally {
      swapBusy = '';
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
    saved = false;
    settingsError = '';
    // The same start and end means "no quiet hours" to the server.
    if (quietEnabled && quietFrom === quietTo) {
      settingsError = 'Godziny ciszy muszą się zaczynać i kończyć o różnych godzinach.';
      return;
    }
    saving = true;
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
    {#if session.isAdmin && otherAdults.length > 0}
      <button class="btn ghost block" onclick={openAdmin}><Icon name="key" /> Przekaż rolę administratora</button>
    {/if}
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
      {#if session.children.length > 0}
        <button class="row member" onclick={openSwap}>
          <Icon name="phone" />
          <span class="grow">
            <span class="title">Przełącz na konto dziecka</span>
            <span class="meta">Dla dziecka bez własnego telefonu</span>
          </span>
          <Icon name="chevron" size={20} />
        </button>
      {/if}
      <a class="row member" href="/parent/settings/theme">
        <Icon name="palette" />
        <span class="grow">
          <span class="title">Wygląd aplikacji</span>
          <span class="meta">{ADULT_THEMES.find((t) => t.id === session.me?.theme)?.title ?? NEUTRAL.title}</span>
        </span>
        <Icon name="chevron" size={20} />
      </a>
      {#if selfUpdates}
        <a class="row member" href="/update">
          <Icon name="download" />
          <span class="grow title">Wersja aplikacji</span>
          <Icon name="chevron" size={20} />
        </a>
      {/if}
      {#if showSupport}
        <a class="row member" href={SUPPORT_URL} target="_blank" rel="noopener">
          <Icon name="coffee" />
          <span class="grow title">Postaw twórcy kawę<span class="muted small support-sub">Aplikacja jest darmowa i bez reklam</span></span>
          <Icon name="chevron" size={20} />
        </a>
      {/if}
      <a class="row member" href="/about">
        <Icon name="info" />
        <span class="grow title">O aplikacji</span>
        <Icon name="chevron" size={20} />
      </a>
      <button class="row member" onclick={() => session.signOut()}>
        <Icon name="logout" />
        <span class="grow title">Wyloguj się</span>
      </button>
      <button class="row member danger-text" onclick={() => openDelete()}>
        <Icon name="trash" />
        <span class="grow title">{session.isAdmin ? 'Usuń rodzinę' : 'Usuń konto'}</span>
      </button>
    </div>
  </section>
</main>

<InviteSheet bind:open={inviteOpen} role={inviteRole} memberId={inviteMember?.id ?? null} memberName={inviteMember?.name ?? null} />

<Sheet bind:open={memberOpen} title={selected?.name}>
  {#if selected}
    {#if isMe && selected.role === 'parent'}
      <!-- Photos are for adults only; children use avatars (Google Play Families policy). -->
      <AvatarPicker name={editName || selected.name} currentUrl={selected.avatarUrl} bind:blob={avatarBlob} />
      <div class="center"><button type="button" class="btn ghost small" onclick={openAvatars}><Icon name="user" size={18} /> Albo wybierz awatar</button></div>
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
          {#if selected.role === 'child'}
            Profil {selected.name} zostanie usunięty razem z punktami, naklejkami, historią zadań i zdjęciem. Telefon zostanie wylogowany. Tego nie da się cofnąć.
          {:else}
            Konto {selected.name} zostanie usunięte (e-mail, hasło, zdjęcie), a telefon wylogowany. Założone przez tę osobę zadania przejdą na Ciebie.
          {/if}
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

<Sheet bind:open={swapOpen} title="Przełącz na konto dziecka">
  <p class="muted small">
    Dziecko korzysta z aplikacji na Twoim telefonie i widzi tylko swoje ekrany. Twoje konto pozostaje zalogowane. Aby wrócić, wybierz w profilu
    dziecka „Wróć do rodzica” i odblokuj telefon (odcisk palca, twarz, PIN albo wzór) lub podaj swoje hasło.
  </p>
  <div class="list">
    {#each session.children as m (m.id)}
      <button class="row member" onclick={() => swapTo(m)} disabled={!!swapBusy}>
        <Avatar name={m.name} url={m.avatarUrl} frameUrl={m.frameUrl} />
        <span class="grow title">{m.name}</span>
        {#if swapBusy === m.id}<span class="meta">Przełączanie…</span>{:else}<Icon name="chevron" size={20} />{/if}
      </button>
    {/each}
  </div>
  {#if swapError}<div class="error-box" role="alert">{swapError}</div>{/if}
</Sheet>

<Sheet bind:open={avatarsOpen} title="Awatar">
  {#if avatarsError}<div class="error-box">{avatarsError}</div>{/if}
  {#if session.me}
    <ThemeAvatarGrid avatars={themeAvatars} theme={session.me.theme} selectedId={session.me.avatarItemId} onpick={(a) => wearAvatar(a.id)}>
      {#if session.me.avatarItemId}
        <button class="btn block" onclick={() => wearAvatar(null)}>Bez awatara (zdjęcie albo inicjały)</button>
      {/if}
    </ThemeAvatarGrid>
    {#if !themeAvatars.length && !avatarsError}<p class="empty">Wczytywanie…</p>{/if}
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
        <label class="field">
          <span>Powtórz nowe hasło</span>
          <input type="password" bind:value={newPassword2} required minlength="8" autocomplete="new-password" />
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

<Sheet bind:open={adminOpen} title="Przekaż rolę administratora">
  <form class="stack" onsubmit={transferAdmin}>
    <label class="field">
      <span>Nowy administrator</span>
      <select bind:value={adminTarget} required>
        {#each otherAdults as m (m.id)}<option value={m.id}>{m.name}{m.email ? ` (${m.email})` : ''}</option>{/each}
      </select>
    </label>
    <div class="error-box">
      {session.member(adminTarget)?.name ?? 'Ta osoba'} będzie zmieniać ustawienia rodziny, zarządzać dorosłymi i usuwać członków.
      Ty zostaniesz zwykłym rodzicem i nie cofniesz tego sam.
    </div>
    <label class="field">
      <span>Twoje hasło</span>
      <input type="password" bind:value={adminPassword} required autocomplete="current-password" />
    </label>
    {#if adminError}<div class="error-box" role="alert">{adminError}</div>{/if}
    <div class="inline">
      <button type="button" class="btn grow" onclick={() => (adminOpen = false)}>Anuluj</button>
      <button class="btn primary grow" disabled={adminBusy || !adminPassword || !adminTarget}>
        {adminBusy ? 'Zapisywanie…' : 'Przekaż rolę'}
      </button>
    </div>
  </form>
</Sheet>

<Sheet bind:open={deleteOpen} title={deleteMode === 'family' ? 'Usuń całą rodzinę' : 'Usuń konto'}>
  <form class="stack" onsubmit={deleteAccount}>
    <div class="error-box">
      {#if deleteMode === 'family'}
        Usuniesz rodzinę {session.family?.name} i wszystko, co w niej jest: profile dzieci, zadania, punkty, naklejki, nagrody, własne
        paczki i zdjęcia, a także konta wszystkich dorosłych. <strong>Twoje konto też zostanie usunięte</strong> i nie zalogujesz się już
        tym e-mailem. Wszystkie telefony zostaną wylogowane.
      {:else}
        Usuniesz swoje konto: e-mail, hasło, imię i zdjęcie. Rodzina i dzieci zostają, a założone przez Ciebie zadania przejdą na
        administratora.
      {/if}
      <strong>Tego nie da się cofnąć.</strong>
    </div>
    {#if deleteMode === 'family' && otherAdults.length > 0}
      <p class="muted small">Chcesz tylko odejść, a rodzinę zostawić? Najpierw przekaż rolę administratora innemu dorosłemu, potem usuń swoje konto.</p>
      <button
        type="button"
        class="btn ghost block"
        onclick={() => {
          deleteOpen = false;
          openAdmin();
        }}><Icon name="key" /> Przekaż rolę administratora</button
      >
    {/if}
    {#if deleteMode === 'family'}
      <label class="field">
        <span>Wpisz nazwę rodziny: {session.family?.name}</span>
        <input type="text" bind:value={deleteConfirmName} required autocomplete="off" />
      </label>
    {/if}
    <label class="field">
      <span>Hasło</span>
      <input type="password" bind:value={deletePassword} required autocomplete="current-password" />
    </label>
    {#if deleteError}<div class="error-box" role="alert">{deleteError}</div>{/if}
    <div class="inline">
      <button type="button" class="btn grow" onclick={() => (deleteOpen = false)}>Anuluj</button>
      <button class="btn danger grow" disabled={deleteBusy || !deletePassword || !deleteNameOk}>
        {deleteBusy ? 'Usuwanie…' : deleteMode === 'family' ? 'Usuń rodzinę' : 'Usuń konto'}
      </button>
    </div>
  </form>
</Sheet>

<style>
  .support-sub {
    display: block;
    font-weight: 400;
  }
  .member {
    appearance: none;
    border: 0;
    background: none;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    text-decoration: none;
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
