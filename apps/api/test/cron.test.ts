import { addDays, zonedToEpoch } from '@choreapp/core';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env.js';
import { runCron } from '../src/services/cron.js';
import { addChild, call, env, registerFamily, type Family } from './helpers.js';

const TZ = 'Europe/Warsaw';
const cronEnv = env as unknown as Env;
const at = (date: string, time: string, tz = TZ) => zonedToEpoch(date, time, tz);

/** Handles every family's pending work at `now`, so a test sees only its own families. */
async function drain(now: number) {
  await runCron(cronEnv, now, { budget: Number.POSITIVE_INFINITY });
}

async function markers(familyId: string) {
  return (await env.DB.prepare('SELECT occ_through_date, reminder_date FROM family WHERE id = ?').bind(familyId).first<{
    occ_through_date: string | null;
    reminder_date: string | null;
  }>())!;
}

async function occurrenceDates(taskId: string): Promise<string[]> {
  const r = await env.DB.prepare('SELECT date FROM occurrence WHERE task_id = ? ORDER BY date').bind(taskId).all<{ date: string }>();
  return r.results.map((x) => x.date);
}

async function reminders(memberId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE member_id = ? AND type = 'reminder'").bind(memberId).first<{ n: number }>();
  return r!.n;
}

async function task(fam: Family, kid: string, startDate: string, kind: 'once' | 'daily'): Promise<string> {
  const r = await call('POST', '/v1/tasks', {
    token: fam.parentToken,
    json: { title: 'Pokój', icon: 'broom', assignees: [kid], startDate, recurrence: { kind } },
  });
  expect(r.status).toBe(201);
  return r.body.id;
}

describe('cron', () => {
  it('tops up occurrences once per family-local day', async () => {
    const d = '2030-03-11';
    await drain(at(d, '06:00'));
    const fam = await registerFamily();
    const ola = await addChild(fam);
    const t = await task(fam, ola.id, d, 'daily');
    await env.DB.prepare('DELETE FROM occurrence WHERE task_id = ?').bind(t).run();

    const first = await runCron(cronEnv, at(d, '10:00'));
    expect(first.processed).toBe(1);
    expect(await markers(fam.familyId)).toMatchObject({ occ_through_date: d, reminder_date: null });
    expect(await occurrenceDates(t)).toHaveLength(15);

    // Nothing left today: no family work, no queries.
    const again = await runCron(cronEnv, at(d, '10:05'));
    expect(again).toMatchObject({ processed: 0, queries: 0 });

    // Next day only the day entering the horizon is added.
    await runCron(cronEnv, at(addDays(d, 1), '10:00'), { budget: Number.POSITIVE_INFINITY });
    expect((await markers(fam.familyId)).occ_through_date).toBe(addDays(d, 1));
    const dates = await occurrenceDates(t);
    expect(dates).toHaveLength(16);
    expect(dates.at(-1)).toBe(addDays(d, 15));
  });

  it('sends the reminder once, after the reminder time', async () => {
    const d = '2030-04-01';
    await drain(at(d, '14:00'));
    const fam = await registerFamily();
    // Other families keep the default 15:00, so only this one is due at 14:30.
    await call('PATCH', '/v1/family', { token: fam.parentToken, json: { reminderTime: '14:30' } });
    const ola = await addChild(fam);
    await task(fam, ola.id, d, 'once');

    await runCron(cronEnv, at(d, '14:25'));
    expect(await reminders(ola.id)).toBe(0);
    expect((await markers(fam.familyId)).reminder_date).toBeNull();

    const due = await runCron(cronEnv, at(d, '14:30'));
    expect(due.processed).toBe(1);
    expect(await reminders(ola.id)).toBe(1);
    expect(await markers(fam.familyId)).toMatchObject({ reminder_date: d, occ_through_date: d });

    const later = await runCron(cronEnv, at(d, '14:35'));
    expect(later).toMatchObject({ processed: 0, queries: 0 });
    expect(await reminders(ola.id)).toBe(1);
  });

  it('stops at the query budget and picks the rest up on the next run, due reminders first', async () => {
    const d = '2030-04-02';
    await drain(at(d, '16:00'));
    // Created first, but only needs an occurrence top-up (reminder at 23:00).
    const late = await registerFamily('Późni');
    await call('PATCH', '/v1/family', { token: late.parentToken, json: { reminderTime: '23:00' } });
    const fams: Family[] = [];
    const kids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const fam = await registerFamily(`Rodzina ${i}`);
      const kid = await addChild(fam);
      await task(fam, kid.id, d, 'once');
      fams.push(fam);
      kids.push(kid.id);
    }
    const remindedCount = async () => (await Promise.all(kids.map(reminders))).reduce((a, b) => a + b, 0);

    const r1 = await runCron(cronEnv, at(d, '16:00'), { budget: 1 });
    expect(r1).toMatchObject({ processed: 1, deferred: 3 });
    expect(await remindedCount()).toBe(1);
    expect((await markers(late.familyId)).occ_through_date).toBeNull();

    const r2 = await runCron(cronEnv, at(d, '16:05'), { budget: 1 });
    expect(r2).toMatchObject({ processed: 1, deferred: 2 });
    expect(await remindedCount()).toBe(2);

    const r3 = await runCron(cronEnv, at(d, '16:10'));
    expect(r3).toMatchObject({ processed: 2, deferred: 0 });
    expect(await remindedCount()).toBe(3);
    for (const f of fams) expect((await markers(f.familyId)).reminder_date).toBe(d);
    expect(await markers(late.familyId)).toMatchObject({ occ_through_date: d, reminder_date: null });
  });

  it('a failing family does not block the others and is retried', async () => {
    const d = '2030-04-03';
    await drain(at(d, '16:00'));
    const badTz = await registerFamily('Zła strefa');
    const badTask = await registerFamily('Zła reguła');
    const good = await registerFamily('Dobra');
    const goodKid = await addChild(good);
    await task(good, goodKid.id, d, 'once');
    await env.DB.prepare("UPDATE family SET timezone = 'Not/AZone' WHERE id = ?").bind(badTz.familyId).run();
    const brokenId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO task (id, family_id, series_id, title, icon, points, start_date, recurrence, created_by, created_at) VALUES (?, ?, ?, 'X', 'broom', 10, ?, 'FREQ=NOPE;;', ?, 0)",
    )
      .bind(brokenId, badTask.familyId, brokenId, d, badTask.parentId)
      .run();
    try {
      const r = await runCron(cronEnv, at(d, '16:00'));
      expect(r).toMatchObject({ processed: 1, failed: 2 });
      expect(await reminders(goodKid.id)).toBe(1);
      expect(await markers(good.familyId)).toMatchObject({ occ_through_date: d, reminder_date: d });
      // The occurrence step failed, so it is not marked; the reminder pass (no children) is.
      expect((await markers(badTask.familyId)).occ_through_date).toBeNull();

      const retry = await runCron(cronEnv, at(d, '16:05'));
      expect(retry).toMatchObject({ processed: 0, failed: 2 });
    } finally {
      await env.DB.prepare('DELETE FROM task WHERE id = ?').bind(brokenId).run();
      await env.DB.prepare('UPDATE family SET timezone = ? WHERE id = ?').bind(TZ, badTz.familyId).run();
    }
  });

  it('follows the family-local date across midnight in its own timezone', async () => {
    const nz = 'Pacific/Auckland';
    const d = '2030-05-01';
    await drain(at(d, '23:50', nz));
    const fam = await registerFamily('Kiwi');
    const ola = await addChild(fam);
    await env.DB.prepare('UPDATE family SET timezone = ? WHERE id = ?').bind(nz, fam.familyId).run();
    const t = await task(fam, ola.id, d, 'daily');

    await runCron(cronEnv, at(d, '23:55', nz));
    expect((await markers(fam.familyId)).occ_through_date).toBe(d);
    // Still 1 May in Auckland: nothing to do.
    expect(await runCron(cronEnv, at(d, '23:59', nz))).toMatchObject({ processed: 0 });

    // Five minutes later it is 2 May in Auckland (still 1 May in Warsaw and UTC).
    await runCron(cronEnv, at(addDays(d, 1), '00:00', nz), { budget: Number.POSITIVE_INFINITY });
    expect((await markers(fam.familyId)).occ_through_date).toBe(addDays(d, 1));
    expect((await occurrenceDates(t)).at(-1)).toBe(addDays(d, 15));
  });
});
