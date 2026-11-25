<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { leaveIfSignedIn } from '#lib/guards.svelte.js';

  leaveIfSignedIn();

  // A few of the real theme avatars, stuck around the icon like stickers.
  const kids = [
    { src: '/welcome/kawaii-girl2.webp', cls: 'k1' },
    { src: '/welcome/space-boy2.webp', cls: 'k2' },
    { src: '/welcome/axolotl-girl3.webp', cls: 'k3' },
    { src: '/welcome/forest-boy1.webp', cls: 'k4' },
  ];
</script>

<main class="welcome">
  <header class="band">
    <div class="stage">
      {#each kids as k (k.src)}
        <img class="kid {k.cls}" src={k.src} alt="" width="64" height="64" />
      {/each}
      <img class="logo" src="/logo.png" alt="" width="120" height="120" />
    </div>
  </header>

  <div class="body">
    <div class="title">
      <h1>Zadania</h1>
      <p class="tagline">rodzinne misje</p>
    </div>

    <section class="part">
      <p class="lead"><b>Dla dzieci.</b> Odhaczaj swoje zadania, zbieraj punkty i&nbsp;naklejki.</p>
      <a class="btn kid-btn block" href="/join">
        <Icon name="qr" size={24} /> Mam kod od rodzica
      </a>
    </section>

    <section class="part">
      <p class="lead"><b>Dla rodziców.</b> Ustalasz zadania i&nbsp;nagrody, a&nbsp;potem tylko zatwierdzasz.</p>
      <a class="btn parent-btn block" href="/login">Zaloguj się jako rodzic</a>
      <a class="btn ghost block new-family" href="/register">Załóż nową rodzinę</a>
    </section>
  </div>
</main>

<style>
  .welcome {
    --orange: #fa901d;
    --orange-hi: #fba72f;
    --cream: #fff6ea;
    --brown: #5b3416;
    --brown-soft: #8a5a32;
    min-height: 100dvh;
    background: var(--cream);
    color: var(--brown);
    font-family: 'Baloo 2', var(--font);
    display: flex;
    flex-direction: column;
  }

  /* The icon's orange, as a band the icon sits on. */
  .band {
    background: radial-gradient(120% 90% at 50% 40%, var(--orange-hi), var(--orange));
    padding: calc(var(--safe-top) + clamp(16px, 5vh, 40px)) 16px clamp(22px, 5vh, 40px);
    border-radius: 0 0 50% 50% / 0 0 32px 32px;
    display: flex;
    justify-content: center;
  }
  .stage {
    position: relative;
    width: 288px;
    height: clamp(132px, 27vh, 230px);
    display: grid;
    place-items: center;
  }
  .logo {
    width: clamp(96px, 20vh, 150px);
    height: auto;
    border-radius: 30px;
    border: 3px solid var(--brown);
    position: relative;
    z-index: 1;
  }
  .kid {
    position: absolute;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #fff;
    border: 3px solid var(--brown);
    object-fit: cover;
  }
  .k1 { left: 2px; top: 4%; transform: rotate(-8deg); }
  .k2 { left: 30px; bottom: -22%; transform: rotate(6deg); width: 56px; height: 56px; }
  .k3 { right: 6px; top: -2%; transform: rotate(7deg); width: 54px; height: 54px; }
  .k4 { right: 18px; bottom: -16%; transform: rotate(-5deg); }

  .body {
    flex: 1;
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    padding: 0 20px calc(var(--safe-bottom) + 12px);
    display: flex;
    flex-direction: column;
    gap: clamp(12px, 2.6vh, 24px);
  }
  /* The name floats in whatever height is left; actions stay low, near the thumb. */
  .title {
    margin: auto 0;
    padding-top: clamp(10px, 3vh, 24px);
    text-align: center;
  }
  h1 {
    font-family: inherit;
    font-size: 2.1rem;
    font-weight: 800;
    line-height: 1;
    color: var(--brown);
  }
  .tagline {
    font-weight: 700;
    color: #b85d06;
    font-size: 1.05rem;
  }

  .part {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lead {
    color: var(--brown-soft);
    font-size: 1rem;
    line-height: 1.35;
  }
  .lead b {
    color: var(--brown);
  }

  .btn {
    font-family: inherit;
    font-weight: 700;
  }
  /* Chunky like the icon: solid outline and a flat "pressable" edge, no blur. */
  .kid-btn {
    min-height: 62px;
    font-size: 1.25rem;
    border-radius: 20px;
    background: var(--orange);
    color: #2e1706;
    border: 3px solid var(--brown);
    box-shadow: 0 4px 0 var(--brown);
  }
  .kid-btn:active {
    transform: translateY(3px);
    box-shadow: 0 1px 0 var(--brown);
  }
  .parent-btn {
    border-radius: 16px;
    background: #fff;
    color: var(--brown);
    border: 2px solid var(--brown);
  }
  .new-family {
    color: #b45a05;
    min-height: 40px;
  }

  /* Small phones (e.g. 320x568): tighten so all three actions fit without scrolling. */
  @media (max-height: 600px) {
    .band {
      padding-bottom: 18px;
    }
    .kid-btn {
      min-height: 54px;
      font-size: 1.15rem;
    }
    .lead {
      font-size: 0.95rem;
    }
    .part {
      gap: 8px;
    }
    h1 {
      font-size: 1.9rem;
    }
  }
</style>
