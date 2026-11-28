<script lang="ts">
  /**
   * One booster pack the child opens themselves: swipe along the top strip
   * (or tap a few times), the strip tears off, the sticker(s) slide out,
   * flip and land with an effect that grows with rarity.
   * Only transform/opacity animations (Web Animations + CSS), no sound.
   */
  import type { Rarity } from '@choreapp/core';
  import { onDestroy } from 'svelte';
  import { haptic } from '../native.js';
  import { REASON_CAPTION, type Pack } from '../packGroups.js';
  import { RARITY_LABEL } from '../rarity.js';

  let {
    pack,
    waiting = 0,
    ondone,
  }: {
    pack: Pack;
    /** Packs still queued after this one. */
    waiting?: number;
    ondone: (album: string | null) => void;
  } = $props();
  /** The primary button: on to the next pack, or done. */
  const primaryLabel = $derived(waiting > 0 ? `Następna paczka (${waiting})` : 'Super!');

  /** Layer geometry from packages/seed/booster-packs.py (720 px tall art). */
  const ART: Record<Rarity, { strip: number; body: number; title: [number, number, number, number]; ink: string }> = {
    common: { strip: 80, body: 646, title: [0.31, 0.45, 0.677, 0.554], ink: '#1e56a0' },
    rare: { strip: 78, body: 648, title: [0.322, 0.439, 0.688, 0.534], ink: '#62249c' },
    legendary: { strip: 77, body: 649, title: [0.307, 0.461, 0.68, 0.569], ink: '#ce3074' },
  };
  const art = $derived(ART[pack.rarity]);
  const bodyTop = $derived(((art.strip - 6) / 720) * 100);
  const titleBox = $derived.by(() => {
    const [l, t, r, b] = art.title;
    const h = (art.body / 720) * 100;
    return `left:${l * 100}%;width:${(r - l) * 100}%;top:${bodyTop + t * h}%;height:${(b - t) * h}%`;
  });

  /**
   * Pacing (ms). Calm on purpose: the child should have time to enjoy each
   * beat. Tune here; reduced motion skips all of this (short fades only).
   */
  const T = {
    packIn: 700, // pack arrives on screen
    stripOff: 1100, // torn strip flies away
    glowBeat: 400, // light from the opening before the sticker moves
    burst: 1100, // the glow burst from the opening
    legendaryPreGlow: 800, // legendary: extra glow and tremble before the rise
    /** Sticker rising out of the pack, then flip and land (rise + flip). */
    rise: { common: 550, rare: 650, legendary: 700 } as Record<Rarity, number>,
    flip: { common: 750, rare: 950, legendary: 900 } as Record<Rarity, number>,
    hold: 600, // landed sticker alone before the caption and buttons
    captionIn: 400,
    nextOut: 600, // streak pack: current sticker leaves
    nextIn: 700, // streak pack: the open pack comes back
  };
  const timingVars = `--t-pack-in:${T.packIn}ms;--t-burst:${T.burst}ms;--t-hold:${T.hold}ms;--t-caption-in:${T.captionIn}ms`;

  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const caption = $derived(REASON_CAPTION[pack.reason](pack.streakDays));

  type Stage = 'closed' | 'anim' | 'shown' | 'summary';
  let stage = $state<Stage>('closed');
  let progress = $state(0);
  let index = $state(0);
  let stripOff = $state(false);
  let burst = $state(false);
  /** Effects of the sticker that just landed (re-created per sticker). */
  let fx = $state<{ key: number; rarity: Rarity } | null>(null);
  const item = $derived(pack.items[index]!);
  const last = $derived(index === pack.items.length - 1);

  let packEl: HTMLDivElement | undefined = $state();
  let stripEl: HTMLImageElement | undefined = $state();
  let stickerEl: HTMLDivElement | undefined = $state();
  let overlayEl: HTMLDivElement | undefined = $state();
  let openBtn: HTMLButtonElement | undefined = $state();
  // Focus moves into the pack (screen readers land on "Otwórz paczkę").
  $effect(() => {
    (openBtn ?? overlayEl)?.focus({ preventScroll: true });
  });
  let alive = true;
  onDestroy(() => (alive = false));

  async function tween(el: HTMLElement | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
    if (!el || !alive) throw new Error('gone');
    const a = el.animate(frames, { fill: 'forwards', ...opts });
    await a.finished;
    a.commitStyles();
    a.cancel();
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- gesture
  let lastX: number | null = null;
  let moved = 0;
  let downAt = 0;
  let joltStep = 0;

  function add(amount: number) {
    if (stage !== 'closed') return;
    progress = Math.min(1, progress + amount);
    const step = Math.floor(progress * 12);
    if (step > joltStep) {
      joltStep = step;
      void haptic(progress < 0.4 ? 'light' : progress < 0.8 ? 'medium' : 'heavy');
      if (!reduce && packEl) {
        const a = 2 + progress * 9;
        packEl.animate(
          [
            { transform: 'translate(0,0) rotate(0)' },
            { transform: `translate(${-a}px,${a * 0.3}px) rotate(${-a * 0.35}deg)` },
            { transform: `translate(${a}px,${-a * 0.2}px) rotate(${a * 0.35}deg)` },
            { transform: 'translate(0,0) rotate(0)' },
          ],
          { duration: 180, easing: 'ease-out' },
        );
      }
    }
    if (progress >= 1) void open();
  }
  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lastX = e.clientX;
    moved = 0;
    downAt = Date.now();
  }
  function move(e: PointerEvent) {
    if (lastX === null || !packEl) return;
    const dx = Math.abs(e.clientX - lastX);
    lastX = e.clientX;
    moved += dx;
    // One swipe across the whole strip opens the pack.
    add(dx / (packEl.clientWidth * 0.85));
  }
  function up() {
    // A tap (no swipe): 5 taps open the pack.
    if (lastX !== null && moved < 12 && Date.now() - downAt < 600) add(0.2);
    lastX = null;
  }

  // ---------------------------------------------------------------- opening
  async function open() {
    stage = 'anim';
    void haptic('heavy');
    try {
      stripOff = true;
      burst = true;
      if (reduce) await tween(stripEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
      else
        void tween(
          stripEl,
          [
            { transform: 'none', opacity: 1 },
            { transform: 'translate(25%, -70%) rotate(14deg)', opacity: 1, offset: 0.45 },
            { transform: 'translate(70%, -160%) rotate(32deg)', opacity: 0 },
          ],
          { duration: T.stripOff, easing: 'cubic-bezier(.3,0,.6,1)' },
        );
      await wait(reduce ? 0 : T.glowBeat);
      await reveal();
    } catch {
      /* skipped or closed */
    }
  }

  /** Slides the current sticker out of the pack, flips it and lands it centred. */
  async function reveal() {
    const s = stickerEl!;
    const p = packEl!;
    const r = item.rarity;
    if (reduce) {
      await tween(p, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
      s.style.zIndex = '3';
      await tween(s, [{ opacity: 0, transform: 'none' }, { opacity: 1, transform: 'none' }], { duration: 300 });
      return landed(r);
    }
    const ph = p.clientHeight;
    s.style.zIndex = '1';
    if (r === 'legendary') {
      // Something big is coming: the open pack glows and trembles first.
      burst = false;
      await wait(20);
      burst = true;
      await tween(
        p,
        [
          { transform: 'none' },
          { transform: 'rotate(-1.5deg) translateX(-2px)', offset: 0.2 },
          { transform: 'rotate(1.5deg) translateX(2px) scale(1.02)', offset: 0.45 },
          { transform: 'rotate(-1.5deg) translateX(-2px) scale(1.03)', offset: 0.7 },
          { transform: 'none' },
        ],
        { duration: T.legendaryPreGlow, easing: 'ease-in-out' },
      );
    }
    // Behind the pack front, then slowly up and out of the open top.
    await tween(s, [{ opacity: 1, transform: `translateY(${ph * 0.12}px) scale(.72)` }, { opacity: 1, transform: `translateY(${-ph * 0.5}px) scale(.72)` }], {
      duration: T.rise[r],
      easing: 'cubic-bezier(.25,.6,.3,1)',
    });
    s.style.zIndex = '3';
    void tween(p, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${ph * 0.35}px) scale(.9)` }], {
      duration: Math.round(T.flip[r] * 0.6),
      easing: 'ease-in',
    });
    const turns = r === 'legendary' ? 2 : 1;
    if (r === 'legendary') fx = { key: Date.now(), rarity: r }; // white flash as it spins
    // Flip, a gentle overshoot and settle.
    await tween(
      s,
      [
        { transform: `translateY(${-ph * 0.5}px) scale(.72) rotateY(0deg)` },
        { transform: `translateY(${-ph * 0.08}px) scale(1.08) rotateY(${turns * 360 - 20}deg)`, offset: 0.72 },
        { transform: `translateY(${ph * 0.01}px) scale(.98) rotateY(${turns * 360 + 4}deg)`, offset: 0.88 },
        { transform: `translateY(0) scale(1) rotateY(${turns * 360}deg)` },
      ],
      { duration: T.flip[r], easing: 'cubic-bezier(.33,.6,.35,1)' },
    );
    s.style.transform = 'none';
    landed(r);
  }

  function landed(r: Rarity) {
    if (r !== 'legendary' || reduce) fx = { key: Date.now(), rarity: r };
    void haptic(r === 'common' ? 'medium' : 'success');
    stage = 'shown';
  }

  async function nextSticker() {
    if (last) {
      stage = 'summary';
      return;
    }
    stage = 'anim';
    fx = null;
    try {
      const away = reduce ? 'none' : 'translateY(-30%) scale(.6)';
      await tween(stickerEl, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: away }], { duration: reduce ? 200 : T.nextOut, easing: 'ease-in' });
      index++;
      stickerEl!.style.zIndex = '1';
      stickerEl!.style.opacity = '0';
      // The open pack comes back for the next sticker.
      const from = reduce ? 'none' : 'translateY(30%) scale(.9)';
      await tween(packEl, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: reduce ? 200 : T.nextIn, easing: 'cubic-bezier(.2,.9,.3,1)' });
      await reveal();
    } catch {
      /* skipped or closed */
    }
  }

  // ---------------------------------------------------------------- skip (hold ~1 s)
  let holding = $state(false);
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  function holdStart(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    holding = true;
    holdTimer = setTimeout(skip, 1000);
  }
  function holdEnd() {
    holding = false;
    clearTimeout(holdTimer);
  }
  function skip() {
    holding = false;
    for (const el of [packEl, stripEl, stickerEl]) el?.getAnimations().forEach((a) => a.cancel());
    alive = false; // pending tweens stop
    fx = null;
    stage = 'summary';
  }
  onDestroy(() => clearTimeout(holdTimer));

  // Precomputed decoration positions (no layout work while animating).
  const sparks = (n: number) => Array.from({ length: n }, (_, i) => ({ a: (360 / n) * i + (i % 2) * 11, d: 90 + ((i * 37) % 60), s: 0.6 + ((i * 13) % 5) / 10 }));
  const stars = Array.from({ length: 18 }, (_, i) => ({ x: (i * 53) % 100, delay: ((i * 7) % 12) / 10, dur: 1.6 + ((i * 3) % 10) / 10, s: 0.6 + ((i * 11) % 7) / 10 }));
  const SPARKS: Record<Rarity, ReturnType<typeof sparks>> = { common: sparks(6), rare: sparks(12), legendary: sparks(16) };
</script>

<div
  class="overlay"
  data-rarity={pack.rarity}
  class:reduce
  style={timingVars}
  role="dialog"
  aria-modal="true"
  aria-label="Paczka z naklejkami. {caption}"
  tabindex="-1"
  bind:this={overlayEl}
>
  <p class="why">{caption}</p>

  <div class="stage">
    {#if fx}
      {#key fx.key}
        <div class="fx" data-fx={fx.rarity} aria-hidden="true">
          {#if fx.rarity !== 'common'}<div class="rays"></div>{/if}
          {#if fx.rarity === 'legendary'}<div class="rainbow"></div>{/if}
          {#if fx.rarity === 'rare'}<div class="flash gold"></div>{/if}
          {#if !reduce}
            {#each SPARKS[fx.rarity] as s, i (i)}
              <span class="spark" style:--a="{s.a}deg" style:--d="{s.d}px" style:--s={s.s}></span>
            {/each}
          {/if}
        </div>
        {#if fx.rarity === 'legendary'}
          <div class="flash white" aria-hidden="true"></div>
          {#if !reduce}
            <div class="shower" aria-hidden="true">
              {#each stars as s, i (i)}
                <span class="star" style:left="{s.x}%" style:--delay="{s.delay}s" style:--dur="{s.dur}s" style:--s={s.s}></span>
              {/each}
            </div>
          {/if}
        {/if}
      {/key}
    {/if}

    <!-- The sticker waits inside the pack (behind its front) until it slides out. -->
    <div class="sticker" bind:this={stickerEl} style:opacity={stage === 'summary' ? 0 : undefined}>
      <img src={item.imageUrl} alt={stage === 'shown' ? item.name : ''} draggable="false" />
    </div>

    <div class="pack-wrap" class:hide={stage === 'summary'}>
      {#if pack.rarity === 'legendary' && stage === 'closed'}<div class="aura" aria-hidden="true"></div>{/if}
      <div
        class="pack"
        bind:this={packEl}
        aria-hidden="true"
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={() => (lastX = null)}
      >
        <img class="body" src="/packs/{pack.rarity}-body.webp" alt="" draggable="false" style:top="{bodyTop}%" style:height="{(art.body / 720) * 100}%" />
        {#if pack.rarity === 'legendary'}
          <div class="holo" style:top="{bodyTop}%" style:height="{(art.body / 720) * 100}%" style:--mask="url(/packs/legendary-body.webp)"><i></i></div>
        {/if}
        <div class="title" style={titleBox} style:--ink={art.ink} aria-hidden="true">
          <span class="t1">Zadania</span>
          <span class="t2">rodzinne misje</span>
        </div>
        <div class="tear" style:top="{((art.strip - 3) / 720) * 100}%" style:transform="scaleX({progress})"></div>
        <img
          class="strip"
          bind:this={stripEl}
          src="/packs/{pack.rarity}-strip.webp"
          alt=""
          draggable="false"
          style:height="{(art.strip / 720) * 100}%"
          style:transform={stripOff || reduce ? undefined : `rotate(${-progress * 10}deg)`}
        />
        {#if burst}<div class="burst" style:top="{(art.strip / 720) * 100}%" aria-hidden="true"></div>{/if}
        {#if stage === 'closed' && !reduce}<span class="hint-dot" style:top="{(art.strip / 720) * 50}%" aria-hidden="true"></span>{/if}
      </div>
    </div>
  </div>

  <div class="bottom" aria-live="polite">
    {#if stage === 'closed'}
      <p class="hint" aria-hidden="true">Przesuń palcem po górnym pasku paczki<br /><small>albo stuknij w nią kilka razy</small></p>
      <!-- For TalkBack and keyboards: the swipe/taps above have no other way in. -->
      <button class="sr-open" bind:this={openBtn} onclick={() => stage === 'closed' && ((progress = 1), void open())}>Otwórz paczkę</button>
    {:else if stage === 'shown'}
      <div class="card result landed">
        <h2>{pack.items.length > 1 ? `Naklejka ${index + 1} z ${pack.items.length}` : 'Nowa naklejka!'}</h2>
        <p class="name">{item.name}</p>
        <p class="muted small">{RARITY_LABEL[item.rarity]} · album {item.album}</p>
        {#if last && pack.items.length === 1}
          <div class="actions">
            <button class="btn primary" onclick={() => ondone(null)}>{primaryLabel}</button>
            <button class="btn" onclick={() => ondone(item.album)}>Do albumu</button>
          </div>
        {:else}
          <button class="btn primary block" onclick={nextSticker}>{last ? 'Gotowe!' : 'Następna!'}</button>
        {/if}
      </div>
    {:else if stage === 'summary'}
      <div class="card result">
        <h2>{pack.items.length > 1 ? 'Nowe naklejki!' : 'Nowa naklejka!'}</h2>
        <div class="row-items">
          {#each pack.items as it (it.id)}
            <figure data-rarity={it.rarity}>
              <img src={it.imageUrl} alt={it.name} />
              <figcaption>{it.name}</figcaption>
            </figure>
          {/each}
        </div>
        <div class="actions">
          <button class="btn primary" onclick={() => ondone(null)}>{primaryLabel}</button>
          <button class="btn" onclick={() => ondone(pack.items[pack.items.length - 1]!.album)}>Do albumu</button>
        </div>
      </div>
    {/if}
  </div>

  {#if stage === 'closed' || stage === 'anim'}
    <!-- Held for a second to skip; a tap does nothing. -->
    <button
      class="skip"
      class:holding
      onpointerdown={holdStart}
      onpointerup={holdEnd}
      onpointercancel={holdEnd}
      onpointerleave={holdEnd}
      oncontextmenu={(e) => e.preventDefault()}
      onclick={(e) => e.detail === 0 && skip()}
      aria-label="Pomiń (przytrzymaj albo aktywuj czytnikiem ekranu)"
    >
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15" class="track" />
        <circle cx="18" cy="18" r="15" class="fill" />
      </svg>
      <span>Pomiń</span>
    </button>
  {/if}
</div>

<style>
  /*
   * Old Android WebViews (a never-updated phone can be on Chrome 85-107) drop
   * svh, container units (cqw), aspect-ratio and inset. The pack then
   * collapsed to almost nothing. So sizes here use px/vw/vh and calc() with
   * plain longhands; newer units only come in through @supports.
   */
  .overlay {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: calc(var(--safe-top) + 16px) 16px calc(var(--safe-bottom) + 16px);
    background: radial-gradient(ellipse at 50% 42%, #2a2f55 0%, #0d0f1f 70%);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .why {
    margin: 0;
    padding: 8px 18px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 1.15rem;
    text-align: center;
    box-shadow: 0 4px 16px rgb(0 0 0 / 30%);
    z-index: 4;
    animation: drop-in 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  .stage {
    position: relative;
    flex: 1;
    width: 100%;
    display: grid;
    /* Fixed track: the effects layer is wider than the screen and must overflow
       around the centre, not widen the column (that pushed the sticker right). */
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    place-items: center;
    min-height: 0;
  }
  .stage > * {
    grid-area: 1 / 1;
  }
  .pack-wrap {
    position: relative;
    z-index: 2;
    animation: pack-in var(--t-pack-in) cubic-bezier(0.2, 1.15, 0.4, 1) both;
  }
  .pack-wrap.hide {
    visibility: hidden;
  }
  .pack {
    /* Pack height and width (art is 382 x 720); the title scales with --pw. */
    --ph: min(56vh, 460px);
    --pw: calc(var(--ph) * 382 / 720);
    position: relative;
    width: var(--pw);
    height: var(--ph);
    touch-action: none;
    cursor: grab;
    outline: none;
  }
  @supports (height: 1svh) {
    .pack {
      --ph: min(56svh, 460px);
    }
  }
  .pack img {
    position: absolute;
    left: 0;
    width: 100%;
    pointer-events: none;
  }
  .strip {
    top: 0;
    transform-origin: 100% 100%;
    transition: transform 0.1s linear;
    z-index: 2;
  }
  .title {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: 'Baloo 2', var(--font-display);
    font-weight: 800;
    color: var(--ink);
    line-height: 0.95;
    text-align: center;
    /* White outline. A text stroke needs paint-order on HTML text (Chrome
       123, same as light-dark()), or it eats the letters; older: shadows. */
    text-shadow:
      0 0 2px #fff,
      1px 1px 0 #fff,
      -1px -1px 0 #fff,
      1px -1px 0 #fff,
      -1px 1px 0 #fff;
    white-space: nowrap;
  }
  .t1 {
    font-size: calc(var(--pw) * 0.086);
  }
  .t2 {
    font-size: calc(var(--pw) * 0.041);
  }
  @supports (color: light-dark(#000, #fff)) {
    .title {
      text-shadow: none;
      -webkit-text-stroke: calc(var(--pw) * 0.008) #fff;
      paint-order: stroke fill;
    }
    .t2 {
      -webkit-text-stroke-width: calc(var(--pw) * 0.005);
    }
  }
  .tear {
    position: absolute;
    left: 3%;
    width: 94%;
    height: 4px;
    margin-top: -1px;
    border-radius: 4px;
    background: #fffbe6;
    box-shadow:
      0 0 6px 2px rgb(255 255 255 / 90%),
      0 0 14px 4px rgb(255 220 120 / 60%);
    transform-origin: 0 50%;
    transition: transform 0.1s linear;
    z-index: 3;
  }
  .hint-dot {
    position: absolute;
    left: 8%;
    width: 9%;
    height: calc(var(--pw) * 0.09);
    margin-top: -4.5%;
    border-radius: 50%;
    background: rgb(255 255 255 / 85%);
    box-shadow: 0 0 0 6px rgb(255 255 255 / 30%);
    z-index: 4;
    pointer-events: none;
    animation: hint 2.2s ease-in-out 1s infinite both;
  }
  .burst {
    position: absolute;
    left: 50%;
    width: 120%;
    height: calc(var(--pw) * 0.6);
    margin: -30% 0 0 -60%;
    border-radius: 50%;
    background: radial-gradient(closest-side, #fff 0%, rgb(255 250 220 / 80%) 35%, transparent 100%);
    z-index: 4;
    pointer-events: none;
    animation: burst var(--t-burst) ease-out forwards;
  }
  /* Legendary: holographic shimmer over the foil, glow and tremble before opening. */
  .holo {
    position: absolute;
    left: 0;
    width: 100%;
    overflow: hidden;
    -webkit-mask: var(--mask) center / 100% 100% no-repeat;
    mask: var(--mask) center / 100% 100% no-repeat;
    pointer-events: none;
    opacity: 0.55;
  }
  .holo i {
    position: absolute;
    top: -20%;
    right: -60%;
    bottom: -20%;
    left: -60%;
    background: linear-gradient(
      105deg,
      transparent 30%,
      rgb(255 170 220 / 70%) 40%,
      rgb(255 255 255 / 90%) 46%,
      rgb(160 220 255 / 70%) 52%,
      transparent 62%
    );
    transform: translateX(-60%);
  }
  .aura {
    position: absolute;
    top: -14%;
    right: -30%;
    bottom: -14%;
    left: -30%;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(255 230 250 / 80%), rgb(190 150 255 / 45%) 45%, rgb(120 200 255 / 20%) 70%, transparent);
    opacity: 0.6;
  }
  .sticker {
    position: relative;
    width: min(58vw, 230px);
    height: min(58vw, 230px);
    opacity: 0;
    z-index: 1;
    backface-visibility: visible;
  }
  .sticker img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
  /* Effects behind the landed sticker */
  .fx {
    position: relative;
    width: min(130vw, 560px);
    height: min(130vw, 560px);
    display: grid;
    place-items: center;
    pointer-events: none;
    z-index: 1;
  }
  .fx > * {
    grid-area: 1 / 1;
  }
  .rays {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: repeating-conic-gradient(from 0deg, rgb(255 214 90 / 55%) 0deg 9deg, transparent 9deg 24deg);
    -webkit-mask: radial-gradient(closest-side, #000 25%, transparent 100%);
    mask: radial-gradient(closest-side, #000 25%, transparent 100%);
    animation: fade-in 0.5s ease-out both;
  }
  .fx[data-fx='legendary'] .rays {
    background: repeating-conic-gradient(
      from 0deg,
      rgb(255 120 180 / 55%) 0deg 8deg,
      transparent 8deg 15deg,
      rgb(255 220 100 / 55%) 15deg 23deg,
      transparent 23deg 30deg,
      rgb(120 220 255 / 55%) 30deg 38deg,
      transparent 38deg 45deg
    );
  }
  .rainbow {
    width: 70%;
    height: 70%;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(255 255 255 / 90%), rgb(255 200 240 / 60%) 35%, rgb(180 160 255 / 40%) 55%, rgb(120 220 255 / 25%) 75%, transparent);
    animation: fade-in 0.6s ease-out both;
  }
  .flash {
    pointer-events: none;
    opacity: 0;
  }
  .flash.gold {
    width: 80%;
    height: 80%;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(255 240 180 / 95%), rgb(255 200 60 / 60%) 50%, transparent);
    animation: flash 0.6s ease-out both;
  }
  .flash.white {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background: #fff;
    z-index: 5;
    animation: flash 0.9s ease-out both;
  }
  .spark {
    width: 22px;
    height: 22px;
    background: #fff;
    clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
    opacity: 0;
    animation: spark 1.1s ease-out 0.05s both;
  }
  .fx[data-fx='rare'] .spark {
    background: #ffe27a;
  }
  .fx[data-fx='legendary'] .spark:nth-child(3n) {
    background: #ffb3e0;
  }
  .fx[data-fx='legendary'] .spark:nth-child(3n + 1) {
    background: #9ee7ff;
  }
  .shower {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 4;
    pointer-events: none;
    overflow: hidden;
  }
  .star {
    position: absolute;
    top: -40px;
    width: 26px;
    height: 26px;
    background: #ffe27a;
    clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
    animation: fall var(--dur) linear var(--delay) both;
  }
  .star:nth-child(3n) {
    background: #ffb3e0;
  }
  .star:nth-child(3n + 1) {
    background: #9ee7ff;
  }
  .bottom {
    width: 100%;
    max-width: 420px;
    min-height: 120px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    z-index: 6;
  }
  /* Fixed colours, not the theme's: always light text on a dark pill. */
  .hint {
    margin: 0 0 56px;
    padding: 8px 16px;
    border-radius: 16px;
    background: rgb(0 0 0 / 55%);
    color: #fff;
    text-align: center;
    font-weight: 800;
    line-height: 1.3;
    text-shadow: 0 1px 3px rgb(0 0 0 / 90%);
  }
  .hint small {
    color: #fff;
    font-size: 0.9em;
    font-weight: 600;
  }
  .result {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 16px 16px;
    text-align: center;
    animation: drop-in var(--t-caption-in) cubic-bezier(0.2, 1.3, 0.4, 1) both;
  }
  /* The landed sticker gets a moment on its own before the caption. */
  .result.landed {
    animation-delay: var(--t-hold);
  }
  .reduce .result {
    animation-duration: 0.2s;
    animation-delay: 0s;
  }
  .result h2 {
    margin: 0;
    font-family: var(--font-display);
  }
  .result .name {
    margin: 0;
    font-weight: 800;
    font-size: 1.1rem;
  }
  .result p.muted {
    margin: 0 0 8px;
  }
  /* Stacked, full width: "Następna paczka (N)" fits on one line on small phones. */
  .actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    width: 100%;
    margin-top: 6px;
  }
  .row-items {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin: 6px 0 4px;
  }
  .row-items figure {
    margin: 0;
    width: 30%;
    max-width: 110px;
  }
  .row-items img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
  }
  .row-items figcaption {
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1.15;
  }
  /* Visually hidden, reachable by TalkBack and the keyboard. */
  .sr-open {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .sr-open:focus-visible {
    position: static;
    width: auto;
    height: auto;
    margin: 8px 0 0;
    padding: 8px 16px;
    clip-path: none;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 800;
  }
  .overlay:focus {
    outline: none;
  }
  .skip {
    position: absolute;
    left: 12px;
    bottom: calc(var(--safe-bottom) + 12px);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 6px 6px;
    border: 0;
    border-radius: 999px;
    background: rgb(255 255 255 / 12%);
    color: rgb(255 255 255 / 75%);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 700;
    z-index: 7;
    touch-action: none;
  }
  .skip svg {
    width: 26px;
    height: 26px;
    transform: rotate(-90deg);
  }
  .skip circle {
    fill: none;
    stroke-width: 4;
  }
  .skip .track {
    stroke: rgb(255 255 255 / 25%);
  }
  .skip .fill {
    stroke: #fff;
    stroke-linecap: round;
    stroke-dasharray: 94.25;
    stroke-dashoffset: 94.25;
    transition: stroke-dashoffset 0.2s ease-out;
  }
  .skip.holding .fill {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 1s linear;
  }
  @media (prefers-reduced-motion: no-preference) {
    .overlay[data-rarity='legendary'] .pack-wrap {
      animation:
        pack-in var(--t-pack-in) cubic-bezier(0.2, 1.15, 0.4, 1) both,
        tremble 0.6s ease-in-out 1s infinite;
    }
    .holo i {
      animation: shimmer 2.6s ease-in-out infinite;
    }
    .aura {
      animation: pulse 1.4s ease-in-out infinite alternate;
    }
    .rays {
      animation:
        fade-in 0.5s ease-out both,
        spin 9s linear infinite;
    }
  }
  .reduce .burst,
  .reduce .flash.white {
    display: none;
  }
  @keyframes pack-in {
    from {
      transform: translateY(40px) scale(0.7);
      opacity: 0;
    }
  }
  @keyframes drop-in {
    from {
      transform: translateY(-12px) scale(0.9);
      opacity: 0;
    }
  }
  @keyframes tremble {
    0%,
    100% {
      transform: rotate(0);
    }
    25% {
      transform: rotate(-1.2deg) translateX(-1px);
    }
    75% {
      transform: rotate(1.2deg) translateX(1px);
    }
  }
  @keyframes shimmer {
    from {
      transform: translateX(-60%);
    }
    to {
      transform: translateX(60%);
    }
  }
  @keyframes pulse {
    from {
      opacity: 0.35;
      transform: scale(0.95);
    }
    to {
      opacity: 0.8;
      transform: scale(1.05);
    }
  }
  @keyframes hint {
    0% {
      transform: translateX(0);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    70% {
      transform: translateX(800%);
      opacity: 1;
    }
    100% {
      transform: translateX(800%);
      opacity: 0;
    }
  }
  @keyframes burst {
    from {
      transform: scale(0.2);
      opacity: 1;
    }
    to {
      transform: scale(2.4);
      opacity: 0;
    }
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes flash {
    0% {
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes spark {
    0% {
      opacity: 0;
      transform: rotate(var(--a)) translateY(0) scale(0);
    }
    25% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: rotate(var(--a)) translateY(calc(-1 * var(--d) - 60px)) scale(var(--s));
    }
  }
  @keyframes fall {
    from {
      transform: translateY(0) rotate(0) scale(var(--s));
    }
    to {
      transform: translateY(110vh) rotate(300deg) scale(var(--s));
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
