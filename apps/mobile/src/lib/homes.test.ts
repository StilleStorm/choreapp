import { describe, expect, it } from 'vitest';
import { NO_HOMES, activeHome, addHome, removeHome, restoreHomes, switchHome, updateHome, type Home } from './homes.js';

const home = (token: string, familyId: string): Home => ({
  token,
  familyId,
  familyName: `Dom ${familyId}`,
  memberId: `m-${token}`,
  memberName: 'Ola',
});

describe('homes on a child phone', () => {
  it('migrates the single token of an older version', () => {
    const h = restoreHomes(null, 'old-token');
    expect(h.active).toBe('old-token');
    expect(h.list).toHaveLength(1);
    expect(restoreHomes(null, null)).toEqual(NO_HOMES);
    // Stored list wins over the legacy key; a broken one falls back to it.
    const stored = JSON.stringify(addHome(NO_HOMES, home('a', 'f1')));
    expect(restoreHomes(stored, 'a').list).toEqual([home('a', 'f1')]);
    expect(restoreHomes('{oops', 'old-token').active).toBe('old-token');
  });

  it('fills family details of a migrated home and still dedupes by family', () => {
    let h = restoreHomes(null, 'old');
    h = updateHome(h, 'old', { familyId: 'f1', familyName: 'Dom mamy', memberId: 'm1', memberName: 'Ola' });
    expect(activeHome(h)?.familyName).toBe('Dom mamy');
    h = addHome(h, home('new', 'f1'));
    expect(h.list.map((x) => x.token)).toEqual(['new']);
  });

  it('updating a home with unchanged details returns the same object', () => {
    const h = addHome(addHome(NO_HOMES, home('a', 'f1')), home('b', 'f2'));
    const { token: _t, ...same } = home('a', 'f1');
    expect(updateHome(h, 'a', same)).toBe(h);
    expect(updateHome(h, 'unknown', same)).toBe(h);
    const renamed = updateHome(h, 'a', { ...same, familyName: 'Dom babci' });
    expect(renamed).not.toBe(h);
    expect(renamed.list[0]!.familyName).toBe('Dom babci');
    expect(renamed.list[1]).toBe(h.list[1]);
  });

  it('adds a second home and makes it active', () => {
    let h = addHome(NO_HOMES, home('a', 'f1'));
    h = addHome(h, home('b', 'f2'));
    expect(h.list.map((x) => x.token)).toEqual(['a', 'b']);
    expect(h.active).toBe('b');
    expect(switchHome(h, 'a').active).toBe('a');
    expect(switchHome(h, 'nope').active).toBe('b');
  });

  it('joining the same family again replaces its entry', () => {
    let h = addHome(addHome(NO_HOMES, home('a', 'f1')), home('b', 'f2'));
    h = addHome(h, home('a2', 'f1'));
    expect(h.list.map((x) => x.token)).toEqual(['b', 'a2']);
    expect(h.active).toBe('a2');
  });

  it('removing the active home switches to another one', () => {
    let h = addHome(addHome(NO_HOMES, home('a', 'f1')), home('b', 'f2'));
    h = removeHome(h, 'b');
    expect(h).toEqual({ list: [home('a', 'f1')], active: 'a' });
    // Removing a home that is not active keeps the active one.
    h = removeHome(addHome(h, home('c', 'f3')), 'a');
    expect(h.active).toBe('c');
  });

  it('removing the last home logs the phone out', () => {
    expect(removeHome(addHome(NO_HOMES, home('a', 'f1')), 'a')).toEqual(NO_HOMES);
  });
});
