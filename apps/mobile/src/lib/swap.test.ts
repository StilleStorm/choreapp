import { describe, expect, it } from 'vitest';
import { swapRedirect } from './swap.js';

describe('screens while a child uses an adult phone', () => {
  it('allows the child screens', () => {
    expect(swapRedirect('/child', true)).toBeNull();
    expect(swapRedirect('/child/today', true)).toBeNull();
    expect(swapRedirect('/child/album/Kosmos', true)).toBeNull();
    expect(swapRedirect('/about', true)).toBeNull();
    expect(swapRedirect('/licenses', true)).toBeNull();
  });

  it('blocks adult screens and deep links', () => {
    expect(swapRedirect('/parent', true)).toBe('/child');
    expect(swapRedirect('/parent/settings', true)).toBe('/child');
    expect(swapRedirect('/parent/kids/abc', true)).toBe('/child');
    expect(swapRedirect('/parentx', true)).toBe('/child');
    expect(swapRedirect('/childish', true)).toBe('/child');
  });

  it('blocks logging in, joining and registering', () => {
    expect(swapRedirect('/login', true)).toBe('/child');
    expect(swapRedirect('/join', true)).toBe('/child');
    expect(swapRedirect('/register', true)).toBe('/child');
    expect(swapRedirect('/update', true)).toBe('/child');
    expect(swapRedirect('/welcome', true)).toBe('/child');
  });

  it('leaves only the welcome screen when the child session is gone', () => {
    expect(swapRedirect('/welcome', false)).toBeNull();
    expect(swapRedirect('/child/today', false)).toBe('/welcome');
    expect(swapRedirect('/parent', false)).toBe('/welcome');
    expect(swapRedirect('/login', false)).toBe('/welcome');
  });
});
