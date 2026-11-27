import { describe, expect, it } from 'vitest';
import { FRAME_SCALE, FRAME_SCALE_DELUXE, frameScale } from './frames.js';

describe('frameScale', () => {
  it('draws the first frames at 128% of the avatar', () => {
    expect(frameScale('https://api.example/builtin/frames/kawaii.svg')).toBe(FRAME_SCALE);
    expect(FRAME_SCALE).toBe(1.28);
  });

  it('draws the thicker Ramki Deluxe frames at 140%', () => {
    expect(frameScale('https://api.example/builtin/frames-v2/dragon_coil.webp')).toBe(FRAME_SCALE_DELUXE);
    expect(FRAME_SCALE_DELUXE).toBe(1.4);
  });

  it('falls back to 128% for anything else', () => {
    expect(frameScale(null)).toBe(FRAME_SCALE);
    expect(frameScale(undefined)).toBe(FRAME_SCALE);
    expect(frameScale('https://api.example/v1/files/fam/frames-v2/x.webp?e=1&s=2')).toBe(FRAME_SCALE);
  });
});
