import { addDays, localDateAt, startOfIsoWeek } from '@choreapp/core';
import { describe, expect, it } from 'vitest';
import { alignWeeklyStart } from '../src/routes/tasks.js';
import { addChild, call, env, registerFamily, type Family } from './helpers.js';

const today = () => localDateAt(Date.now(), 'Europe/Warsaw');

async function setup() {
  const fam = await registerFamily();
  const ola = await addChild(fam, 'Ola');
  const kuba = await addChild(fam, 'Kuba');
  return { fam, ola, kuba };
}

function task(fam: Family, assignees: string[], extra: Record<string, unknown> = {}) {
  return call('POST', '/v1/tasks', {
    token: fam.parentToken,
    json: {
      title: 'Posprzątaj pokój',
      icon: 'broom',
      assignees,
      startDate: today(),
      recurrence: { kind: 'once' },
      points: 10,
      ...extra,
    },
  });
}

async function agenda(token: string, q = '') {
  return (await call('GET', `/v1/agenda${q}`, { token })).body;
}

async function report(memberId: string, occurrenceId: string, status = 'reported', at = Date.now()) {
  await env.DB.prepare('INSERT INTO completion (id, occurrence_id, member_id, status, reported_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), occurrenceId, memberId, status, at)
    .run();
}

describe('creating tasks', () => {
  it('creates a one-off task with all fields', async () => {
    const { fam, ola } = await setup();
    const r = await task(fam, [ola.id], { description: 'Też pod łóżkiem', dueTime: '18:00', points: 20 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      title: 'Posprzątaj pokój',
      icon: 'broom',
      description: 'Też pod łóżkiem',
      points: 20,
      sharedMode: 'each',
      dueTime: '18:00',
      recurrence: { kind: 'once' },
      recurrenceText: 'Jednorazowo',
      assignees: [ola.id],
      nextDate: today(),
    });
  });

  it('defaults to medium points and validates sizes', async () => {
    const { fam, ola } = await setup();
    const r = await call('POST', '/v1/tasks', {
      token: fam.parentToken,
      json: { title: 'X', icon: 'broom', assignees: [ola.id], startDate: today(), recurrence: { kind: 'daily' } },
    });
    expect(r.body.points).toBe(10);
    expect((await task(fam, [ola.id], { points: 7 })).status).toBe(400);
  });

  it('only assigns children of the family', async () => {
    const { fam } = await setup();
    const other = await registerFamily('Inni');
    const stranger = await addChild(other);
    expect((await task(fam, [stranger.id])).status).toBe(400);
    expect((await task(fam, [fam.parentId])).status).toBe(400);
  });

  it('children cannot create tasks', async () => {
    const { ola } = await setup();
    const r = await call('POST', '/v1/tasks', {
      token: ola.token,
      json: { title: 'X', icon: 'broom', assignees: [ola.id], startDate: today(), recurrence: { kind: 'once' } },
    });
    expect(r.status).toBe(403);
  });

  it('a single assignee is always "each"', async () => {
    const { fam, ola } = await setup();
    expect((await task(fam, [ola.id], { sharedMode: 'any' })).body.sharedMode).toBe('each');
  });
});

describe('agenda', () => {
  it('shows a daily task every day for each child', async () => {
    const { fam, ola, kuba } = await setup();
    await task(fam, [ola.id, kuba.id], { recurrence: { kind: 'daily' } });
    const a = await agenda(fam.parentToken, `?from=${today()}&to=${addDays(today(), 6)}`);
    expect(a.items).toHaveLength(7);
    expect(a.items[0].children.map((c: any) => c.state)).toEqual(['todo', 'todo']);
    expect(a.items[1].children[0].state).toBe('upcoming');
  });

  it('children see only their own tasks', async () => {
    const { fam, ola, kuba } = await setup();
    await task(fam, [ola.id], { title: 'Dla Oli' });
    await task(fam, [kuba.id], { title: 'Dla Kuby' });
    const a = await agenda(ola.token, `?member=${kuba.id}`);
    expect(a.items.map((i: any) => i.title)).toEqual(['Dla Oli']);
    expect(a.items[0].children).toHaveLength(1);
  });

  it('keeps overdue tasks on the list until done', async () => {
    const { fam, ola } = await setup();
    await task(fam, [ola.id], { startDate: addDays(today(), -3), title: 'Zaległe' });
    const withOverdue = await agenda(ola.token, '?overdue=1');
    expect(withOverdue.items).toHaveLength(1);
    expect(withOverdue.items[0].children[0]).toMatchObject({ state: 'overdue', canReport: true });
    expect((await agenda(ola.token)).items).toHaveLength(0);

    await report(ola.id, withOverdue.items[0].occurrenceId, 'approved');
    expect((await agenda(ola.token, '?overdue=1')).items).toHaveLength(0);
  });

  it('a reported overdue task stays visible as waiting', async () => {
    const { fam, ola } = await setup();
    await task(fam, [ola.id], { startDate: addDays(today(), -1) });
    const a = await agenda(ola.token, '?overdue=1');
    await report(ola.id, a.items[0].occurrenceId);
    const b = await agenda(ola.token, '?overdue=1');
    expect(b.items[0].children[0].state).toBe('reported');
  });

  it('shared "any" task closes for the sibling once one child is approved', async () => {
    const { fam, ola, kuba } = await setup();
    await task(fam, [ola.id, kuba.id], { sharedMode: 'any', title: 'Wynieś śmieci' });
    const a = await agenda(fam.parentToken);
    await report(ola.id, a.items[0].occurrenceId, 'approved');
    const b = await agenda(fam.parentToken);
    const states = Object.fromEntries(b.items[0].children.map((c: any) => [c.memberId, c.state]));
    expect(states).toEqual({ [ola.id]: 'approved', [kuba.id]: 'closed' });
  });

  it('"each" mode tracks every child separately', async () => {
    const { fam, ola, kuba } = await setup();
    await task(fam, [ola.id, kuba.id], { startDate: addDays(today(), -1) });
    const a = await agenda(fam.parentToken, '?overdue=1');
    await report(ola.id, a.items[0].occurrenceId, 'approved');
    const b = await agenda(fam.parentToken, '?overdue=1');
    expect(b.items).toHaveLength(1);
    const states = Object.fromEntries(b.items[0].children.map((c: any) => [c.memberId, c.state]));
    expect(states).toEqual({ [ola.id]: 'approved', [kuba.id]: 'overdue' });
  });

  it('removed children disappear from the agenda', async () => {
    const { fam, ola, kuba } = await setup();
    await task(fam, [ola.id, kuba.id]);
    await call('DELETE', `/v1/members/${kuba.id}`, { token: fam.parentToken });
    const a = await agenda(fam.parentToken);
    expect(a.items[0].children.map((c: any) => c.memberId)).toEqual([ola.id]);
  });

  it('weekly tasks follow chosen days', async () => {
    const { fam, ola } = await setup();
    const monday = startOfIsoWeek(addDays(today(), 7));
    await task(fam, [ola.id], { startDate: monday, recurrence: { kind: 'weekly', interval: 1, days: [1, 3, 5] } });
    const a = await agenda(ola.token, `?from=${monday}&to=${addDays(monday, 6)}`);
    expect(a.items.map((i: any) => i.date)).toEqual([monday, addDays(monday, 2), addDays(monday, 4)]);
  });
});

describe('editing a series changes only the future', () => {
  it('splits a started series, keeping history on the old version', async () => {
    const { fam, ola } = await setup();
    const start = addDays(today(), -5);
    const created = await task(fam, [ola.id], { startDate: start, recurrence: { kind: 'daily' }, points: 5, title: 'Stary' });
    // Generate the past days the way the cron would have, and finish one.
    await env.DB.prepare('INSERT INTO occurrence (id, task_id, date) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), created.body.id, addDays(today(), -2))
      .run();
    const past = await env.DB.prepare('SELECT id FROM occurrence WHERE task_id = ? AND date = ?')
      .bind(created.body.id, addDays(today(), -2))
      .first<{ id: string }>();
    await report(ola.id, past!.id, 'approved');

    const edited = await call('PATCH', `/v1/tasks/${created.body.id}`, {
      token: fam.parentToken,
      json: { title: 'Nowy', icon: 'broom', assignees: [ola.id], startDate: start, recurrence: { kind: 'daily' }, points: 20 },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.id).not.toBe(created.body.id);
    expect(edited.body.seriesId).toBe(created.body.seriesId);
    expect(edited.body.startDate).toBe(today());

    const old = await env.DB.prepare('SELECT * FROM task WHERE id = ?').bind(created.body.id).first<any>();
    expect(old.end_date).toBe(addDays(today(), -1));
    expect(old.title).toBe('Stary');
    expect(old.points).toBe(5);

    const a = await agenda(ola.token, `?from=${today()}&to=${addDays(today(), 2)}`);
    expect(a.items.map((i: any) => [i.title, i.points])).toEqual([
      ['Nowy', 20],
      ['Nowy', 20],
      ['Nowy', 20],
    ]);
    const tasks = await call('GET', '/v1/tasks', { token: fam.parentToken });
    expect(tasks.body.map((t: any) => t.title)).toEqual(['Nowy']);
  });

  it("keeps today's reported occurrence on the old version and starts tomorrow", async () => {
    const { fam, ola } = await setup();
    const created = await task(fam, [ola.id], { startDate: addDays(today(), -1), recurrence: { kind: 'daily' }, title: 'Stary' });
    const a = await agenda(ola.token);
    await report(ola.id, a.items[0].occurrenceId);
    const edited = await call('PATCH', `/v1/tasks/${created.body.id}`, {
      token: fam.parentToken,
      json: { title: 'Nowy', icon: 'broom', assignees: [ola.id], startDate: today(), recurrence: { kind: 'daily' } },
    });
    expect(edited.body.startDate).toBe(addDays(today(), 1));
    const b = await agenda(ola.token, `?from=${today()}&to=${addDays(today(), 1)}`);
    expect(b.items.map((i: any) => i.title)).toEqual(['Stary', 'Nowy']);
  });

  it('edits a series that has not started in place', async () => {
    const { fam, ola } = await setup();
    const created = await task(fam, [ola.id], { startDate: addDays(today(), 3), recurrence: { kind: 'daily' } });
    const edited = await call('PATCH', `/v1/tasks/${created.body.id}`, {
      token: fam.parentToken,
      json: { title: 'Inny', icon: 'dog', assignees: [ola.id], startDate: addDays(today(), 5), recurrence: { kind: 'daily' } },
    });
    expect(edited.body.id).toBe(created.body.id);
    const a = await agenda(ola.token, `?from=${today()}&to=${addDays(today(), 6)}`);
    expect(a.items.map((i: any) => i.date)).toEqual([addDays(today(), 5), addDays(today(), 6)]);
  });

  it('a one-off task can be edited until it is reported', async () => {
    const { fam, ola } = await setup();
    const created = await task(fam, [ola.id]);
    const ok = await call('PATCH', `/v1/tasks/${created.body.id}`, {
      token: fam.parentToken,
      json: { title: 'Zmienione', icon: 'broom', assignees: [ola.id], startDate: addDays(today(), 1), recurrence: { kind: 'once' } },
    });
    expect(ok.body.startDate).toBe(addDays(today(), 1));
    const a = await agenda(ola.token, `?from=${addDays(today(), 1)}`);
    await report(ola.id, a.items[0].occurrenceId);
    const blocked = await call('PATCH', `/v1/tasks/${created.body.id}`, {
      token: fam.parentToken,
      json: { title: 'Jeszcze raz', icon: 'broom', assignees: [ola.id], startDate: today(), recurrence: { kind: 'once' } },
    });
    expect(blocked.status).toBe(409);
  });

  it('keeps the phase of "every 2 weeks"', () => {
    const rec: import('@choreapp/core').Recurrence = { kind: 'weekly', interval: 2, days: [6] };
    // Series started Monday 2026-11-02; on-weeks: Nov 2, Nov 16, Nov 30...
    expect(alignWeeklyStart('2026-11-02', rec, '2026-11-17')).toBe('2026-11-17'); // on-week
    expect(alignWeeklyStart('2026-11-02', rec, '2026-11-24')).toBe('2026-11-30'); // off-week -> next on-week
    expect(alignWeeklyStart('2026-11-02', { kind: 'daily' }, '2026-11-24')).toBe('2026-11-24');
  });
});

describe('deleting', () => {
  it('deletes a single occurrence', async () => {
    const { fam, ola } = await setup();
    await task(fam, [ola.id], { recurrence: { kind: 'daily' } });
    const a = await agenda(fam.parentToken, `?from=${today()}&to=${addDays(today(), 2)}`);
    expect((await call('DELETE', `/v1/occurrences/${a.items[1].occurrenceId}`, { token: fam.parentToken })).status).toBe(200);
    const b = await agenda(fam.parentToken, `?from=${today()}&to=${addDays(today(), 2)}`);
    expect(b.items.map((i: any) => i.date)).toEqual([today(), addDays(today(), 2)]);
  });

  it('deletes the whole series but keeps finished history', async () => {
    const { fam, ola } = await setup();
    const created = await task(fam, [ola.id], { startDate: addDays(today(), -2), recurrence: { kind: 'daily' } });
    for (const d of [-2, -1]) {
      await env.DB.prepare('INSERT INTO occurrence (id, task_id, date) VALUES (?, ?, ?)').bind(crypto.randomUUID(), created.body.id, addDays(today(), d)).run();
    }
    const overdue = await agenda(ola.token, '?overdue=1');
    expect(overdue.items).toHaveLength(3);
    await report(ola.id, overdue.items[0].occurrenceId, 'approved');

    await call('DELETE', `/v1/tasks/${created.body.id}`, { token: fam.parentToken });
    expect((await agenda(ola.token, `?overdue=1&from=${today()}&to=${addDays(today(), 7)}`)).items).toHaveLength(0);
    expect((await call('GET', '/v1/tasks', { token: fam.parentToken })).body).toHaveLength(0);
    const kept = await env.DB.prepare("SELECT COUNT(*) AS n FROM completion WHERE member_id = ? AND status = 'approved'").bind(ola.id).first<any>();
    expect(kept.n).toBe(1);
  });

  it('cannot delete a day that is already done', async () => {
    const { fam, ola } = await setup();
    await task(fam, [ola.id]);
    const a = await agenda(fam.parentToken);
    await report(ola.id, a.items[0].occurrenceId, 'approved');
    expect((await call('DELETE', `/v1/occurrences/${a.items[0].occurrenceId}`, { token: fam.parentToken })).status).toBe(409);
  });
});

describe('week grid', () => {
  it('counts states per child and day', async () => {
    const { fam, ola, kuba } = await setup();
    await task(fam, [ola.id, kuba.id], { recurrence: { kind: 'daily' }, startDate: startOfIsoWeek(today()) });
    const a = await agenda(fam.parentToken);
    await report(ola.id, a.items[0].occurrenceId);
    const w = await call('GET', '/v1/week', { token: fam.parentToken });
    expect(w.body.days).toHaveLength(7);
    expect(w.body.rows).toHaveLength(2);
    const olaToday = w.body.rows.find((r: any) => r.memberId === ola.id).cells.find((c: any) => c.date === today());
    expect(olaToday.waiting).toBe(1);
    const kubaToday = w.body.rows.find((r: any) => r.memberId === kuba.id).cells.find((c: any) => c.date === today());
    expect(kubaToday.todo).toBe(1);
  });
});
