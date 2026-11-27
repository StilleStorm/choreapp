/**
 * How big an avatar frame is drawn, relative to the avatar.
 *
 * The first frames (builtin/frames/*.svg) fit at 128%. The "Ramki Deluxe" set
 * (builtin/frames-v2/*.webp, packages/seed/build-packs.mjs) is thicker, with a
 * smaller opening on its canvas, so it needs 140% to leave the face uncovered.
 * The folder in the image URL tells them apart (built-in URLs are plain
 * `<origin>/builtin/...`), so no extra field is needed in the API.
 */
export const FRAME_SCALE = 1.28;
export const FRAME_SCALE_DELUXE = 1.4;

export function frameScale(frameUrl: string | null | undefined): number {
  return frameUrl && /\/builtin\/frames-v2\//.test(frameUrl) ? FRAME_SCALE_DELUXE : FRAME_SCALE;
}
