<script lang="ts">
  import BackHeader from '#lib/components/BackHeader.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { appVersion } from '#lib/native.js';
  import { session } from '#lib/session.svelte.js';

  const WEBSITE = 'https://stillestormstudio.com/pl';
  const EMAIL = 'zadania@stillestormstudio.com';

  let version = $state('');
  $effect(() => {
    appVersion()
      .then((v) => (version = v.name))
      .catch(() => (version = ''));
  });
</script>

<main class="screen no-tabs">
  <BackHeader title="O aplikacji" back={session.isParent ? '/parent/settings' : '/child/profile'} />

  <section class="card about">
    <h2>Zadania</h2>
    {#if version}<span class="muted small">Wersja {version}</span>{/if}
    {#if session.isParent}
      <p>Stworzone przez <a href={WEBSITE} target="_blank" rel="noopener">Stille Storm Studio</a></p>
      <p>Kontakt: <a href="mailto:{EMAIL}">{EMAIL}</a></p>
    {:else}
      <p>Stworzone przez Stille Storm Studio</p>
    {/if}
    <p class="muted small">Aplikacja nie zbiera danych dzieci poza nazwą wybraną w aplikacji.</p>
  </section>

  <div class="list">
    <a class="row" href="/licenses">
      <Icon name="info" />
      <span class="grow title">Licencje i autorzy grafik</span>
      <Icon name="chevron" size={20} />
    </a>
  </div>

  {#if !session.isParent}
    <p class="small muted links">
      <a href={WEBSITE} target="_blank" rel="noopener">stillestormstudio.com</a> · <a href="mailto:{EMAIL}">kontakt</a>
    </p>
  {/if}
</main>

<style>
  .about {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .about p {
    margin: 0;
  }
  .about a {
    word-break: break-all;
  }
  a.row {
    color: inherit;
    text-decoration: none;
  }
  .links {
    text-align: center;
  }
</style>
