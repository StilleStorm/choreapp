<script lang="ts">
  import { frameScale } from '../frames.js';
  import { initials } from '../image.js';

  let {
    name,
    url = null,
    frameUrl = null,
    size = 44,
  }: { name: string; url?: string | null; frameUrl?: string | null; size?: number } = $props();

  // Stable pastel colour per name for the initials fallback.
  const hue = $derived([...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7));
  // 128% for the first frames, 140% for the thicker Ramki Deluxe set.
  const scale = $derived(frameScale(frameUrl));
</script>

<span class="avatar" style:width="{size}px" style:height="{size}px" style:font-size="{size * 0.4}px">
  {#if url}
    <img src={url} alt="" />
  {:else}
    <span class="initials" style:background="hsl({hue} 70% 85%)" style:color="hsl({hue} 45% 28%)">{initials(name)}</span>
  {/if}
  {#if frameUrl}
    <img class="frame" src={frameUrl} alt="" style:--frame-scale={scale} />
  {/if}
</span>

<style>
  .avatar {
    position: relative;
    display: inline-block;
    flex: none;
  }
  .avatar > img:not(.frame),
  .initials {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 750;
  }
  /* Centred on the avatar, spilling out equally on every side; parents must not
     clip it (no overflow: hidden right around an avatar with a frame). */
  .frame {
    position: absolute;
    inset: calc((1 - var(--frame-scale, 1.28)) * 50%);
    width: calc(var(--frame-scale, 1.28) * 100%);
    height: calc(var(--frame-scale, 1.28) * 100%);
    max-width: none;
    pointer-events: none;
  }
</style>
