import { addDays, localDateAt } from '@choreapp/core';
import { describe, expect, it } from 'vitest';
import { addChild, call, env, registerFamily, type Family } from './helpers.js';

const today = () => localDateAt(Date.now(), 'Europe/Warsaw');
let op = 0;
const opId = () => `op-${Date.now()}-${op++}`;

async function setup() {
  const fam = await registerFamily();
  const ola = await addChild(fam, 'Ola');
  const kuba = await addChild(fam, 'Kuba');
  return { fam, ola, kuba };
}

async function makeTask(fam: Family, assignees: string[], extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/v1/tasks', {
    token: fam.parentToken,
    json: { title: 'Pokój', icon: 'broom', assignees, startDate: today(), recurrence: { kind: 'once' }, points: 10, ...extra },
  });
  return r.body;
}

async function occurrenceFor(token: string, q = '?overdue=1') {
  return (await call('GET', `/v1/agenda${q}`, { token })).body.items[0];
}

async function balance(memberId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM points_ledger WHERE member_id = ?').bind(memberId).first<any>();
  return r.b;
}

describe('reporting', () => {
  it('a child reports today’s task; the parent sees it in the queue', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    const r = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    expect(r.status).toBe(201);
    expect((await occurrenceFor(ola.token)).children[0].state).toBe('reported');
    const q = await call('GET', '/v1/approvals', { token: fam.parentToken });
    expect(q.body).toHaveLength(1);
    expect(q.body[0]).toMatchObject({ memberName: 'Ola', title: 'Pokój', points: 10, late: false });
  });

  it('is idempotent for the offline queue', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    const id = opId();
    const a = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: id } });
    const b = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: id } });
    expect(b.status).toBe(200);
    expect(b.body.completionId).toBe(a.body.completionId);
    const other = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    expect(other.status).toBe(409);
    expect(other.body.error).toBe('already_reported');
  });

  it('cannot report future days (no ticking off in advance)', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id], { startDate: addDays(today(), 1) });
    const item = await occurrenceFor(ola.token, `?from=${addDays(today(), 1)}`);
    const r = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('future_task');
  });

  it('can report overdue tasks; the parent sees them flagged late', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id], { startDate: addDays(today(), -2) });
    const item = await occurrenceFor(ola.token);
    expect(item.children[0].state).toBe('overdue');
    const r = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    expect(r.status).toBe(201);
    expect((await call('GET', '/v1/approvals', { token: fam.parentToken })).body[0].late).toBe(true);
  });

  it('only the assigned child can report, and parents cannot report', async () => {
    const { fam, ola, kuba } = await setup();
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    expect((await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: kuba.token, json: { clientOpId: opId() } })).status).toBe(403);
    expect((await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: fam.parentToken, json: { clientOpId: opId() } })).status).toBe(403);
  });

  it('accepts the offline tap time within 48 hours, otherwise uses now', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id], { startDate: addDays(today(), -1) });
    const item = await occurrenceFor(ola.token);
    const tapped = Date.now() - 3 * 3_600_000;
    await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId(), reportedAt: tapped } });
    const row = await env.DB.prepare('SELECT reported_at FROM completion WHERE member_id = ?').bind(ola.id).first<any>();
    expect(row.reported_at).toBe(tapped);
  });
});

describe('approving and rejecting', () => {
  it('approval closes the task and adds the points to the ledger', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id], { points: 20 });
    const item = await occurrenceFor(ola.token);
    const rep = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    expect(await balance(ola.id)).toBe(0); // points only on approval
    const r = await call('POST', `/v1/completions/${rep.body.completionId}/approve`, { token: fam.parentToken });
    expect(r.status).toBe(200);
    expect(r.body.drop.points).toBe(20);
    expect(await balance(ola.id)).toBeGreaterThanOrEqual(20);
    expect((await occurrenceFor(ola.token, '')).children[0].state).toBe('approved');
    expect((await call('GET', '/v1/approvals', { token: fam.parentToken })).body).toHaveLength(0);
  });

  it('two parents approving at once pay only once', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    const rep = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    const [a, b] = await Promise.all([
      call('POST', `/v1/completions/${rep.body.completionId}/approve`, { token: fam.parentToken }),
      call('POST', `/v1/completions/${rep.body.completionId}/approve`, { token: fam.parentToken }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const task = await env.DB.prepare("SELECT COUNT(*) AS n FROM points_ledger WHERE member_id = ? AND reason = 'task'").bind(ola.id).first<any>();
    expect(task.n).toBe(1);
  });

  it('rejection sends the task back with a comment and can be redone', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    const rep = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    const r = await call('POST', `/v1/completions/${rep.body.completionId}/reject`, { token: fam.parentToken, json: { comment: 'Biurko dalej zawalone' } });
    expect(r.status).toBe(200);
    const after = (await occurrenceFor(ola.token)).children[0];
    expect(after).toMatchObject({ state: 'todo', canReport: true });
    expect(after.rejection.comment).toBe('Biurko dalej zawalone');
    expect(await balance(ola.id)).toBe(0);
    const again = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    expect(again.status).toBe(201);
  });

  it('cannot review twice or review another family', async () => {
    const { fam, ola } = await setup();
    const other = await registerFamily('Inni');
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    const rep = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    expect((await call('POST', `/v1/completions/${rep.body.completionId}/approve`, { token: other.parentToken })).status).toBe(404);
    await call('POST', `/v1/completions/${rep.body.completionId}/reject`, { token: fam.parentToken, json: {} });
    expect((await call('POST', `/v1/completions/${rep.body.completionId}/approve`, { token: fam.parentToken })).status).toBe(409);
  });

  it('"any" mode: approving one child closes the sibling’s pending report', async () => {
    const { fam, ola, kuba } = await setup();
    await makeTask(fam, [ola.id, kuba.id], { sharedMode: 'any' });
    const item = await occurrenceFor(ola.token);
    const a = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: kuba.token, json: { clientOpId: opId() } });
    expect((await call('GET', '/v1/approvals', { token: fam.parentToken })).body).toHaveLength(2);
    await call('POST', `/v1/completions/${a.body.completionId}/approve`, { token: fam.parentToken });
    expect((await call('GET', '/v1/approvals', { token: fam.parentToken })).body).toHaveLength(0);
    expect((await occurrenceFor(kuba.token, '')).children[0].state).toBe('closed');
    expect(await balance(kuba.id)).toBe(0);
    // And the sibling can no longer report it.
    const late = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: kuba.token, json: { clientOpId: opId() } });
    expect(late.status).toBe(409);
  });

  it('only parents review', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    const rep = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    expect((await call('POST', `/v1/completions/${rep.body.completionId}/approve`, { token: ola.token })).status).toBe(403);
    expect((await call('GET', '/v1/approvals', { token: ola.token })).status).toBe(403);
  });
});

describe('parent marks a task done ("Zrobione")', () => {
  const complete = (fam: Family, occurrenceId: string, memberId: string, clientOpId = opId(), token = fam.parentToken) =>
    call('POST', `/v1/occurrences/${occurrenceId}/complete`, { token, json: { memberId, clientOpId } });
  const taskRows = async (memberId: string) =>
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM points_ledger WHERE member_id = ? AND reason = 'task'").bind(memberId).first<any>()).n;

  it('creates an approved completion and pays like a normal approve', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id], { points: 20 });
    const item = await occurrenceFor(ola.token);
    const r = await complete(fam, item.occurrenceId, ola.id);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'approved' });
    expect(r.body.drop.points).toBe(20);
    expect(await balance(ola.id)).toBeGreaterThanOrEqual(20);
    expect((await occurrenceFor(ola.token, '')).children[0].state).toBe('approved');
    const row = await env.DB.prepare('SELECT status, reviewed_by FROM completion WHERE id = ?').bind(r.body.completionId).first<any>();
    expect(row).toMatchObject({ status: 'approved', reviewed_by: fam.parentId });
    const n = await env.DB.prepare("SELECT title FROM notification_outbox WHERE member_id = ? AND type = 'approved'").bind(ola.id).first<any>();
    expect(n.title).toBe('Zatwierdzone! +20 pkt');
  });

  it('is idempotent: a double tap with the same key pays once; another key is refused', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    const key = opId();
    const [a, b] = await Promise.all([complete(fam, item.occurrenceId, ola.id, key), complete(fam, item.occurrenceId, ola.id, key)]);
    expect([a.status, b.status]).toContain(201);
    const again = await complete(fam, item.occurrenceId, ola.id, key);
    expect(again.status).toBe(200);
    expect(again.body.drop).toBeNull();
    const other = await complete(fam, item.occurrenceId, ola.id);
    expect(other.status).toBe(409);
    expect(other.body.error).toBe('already_done');
    expect(await taskRows(ola.id)).toBe(1);
  });

  it('two parents with different keys at once pay only once', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    const [a, b] = await Promise.all([complete(fam, item.occurrenceId, ola.id), complete(fam, item.occurrenceId, ola.id)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await taskRows(ola.id)).toBe(1);
  });

  it('approves a report that is already waiting', async () => {
    const { fam, ola } = await setup();
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    const rep = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: opId() } });
    const r = await complete(fam, item.occurrenceId, ola.id);
    expect(r.status).toBe(201);
    expect(r.body.completionId).toBe(rep.body.completionId);
    expect((await call('GET', '/v1/approvals', { token: fam.parentToken })).body).toHaveLength(0);
  });

  it('works for a child without a phone and for overdue days; refuses future days', async () => {
    const { fam } = await setup();
    const kid = (await call('POST', '/v1/members', { token: fam.parentToken, json: { name: 'Zosia' } })).body;
    await makeTask(fam, [kid.id], { startDate: addDays(today(), -1) });
    const agenda = (await call('GET', '/v1/agenda?overdue=1', { token: fam.parentToken })).body;
    const r = await complete(fam, agenda.items[0].occurrenceId, kid.id);
    expect(r.status).toBe(201);
    expect(await balance(kid.id)).toBeGreaterThanOrEqual(10);

    await makeTask(fam, [kid.id], { startDate: addDays(today(), 1), title: 'Jutro' });
    const fut = (await call('GET', `/v1/agenda?from=${addDays(today(), 1)}`, { token: fam.parentToken })).body.items.find(
      (i: any) => i.title === 'Jutro',
    );
    const f = await complete(fam, fut.occurrenceId, kid.id);
    expect(f.status).toBe(409);
    expect(f.body.error).toBe('future_task');
  });

  it('"any" mode: done for one child closes it for the siblings', async () => {
    const { fam, ola, kuba } = await setup();
    await makeTask(fam, [ola.id, kuba.id], { sharedMode: 'any' });
    const item = await occurrenceFor(ola.token);
    await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: kuba.token, json: { clientOpId: opId() } });
    expect((await complete(fam, item.occurrenceId, ola.id)).status).toBe(201);
    expect((await occurrenceFor(kuba.token, '')).children[0].state).toBe('closed');
    expect((await call('GET', '/v1/approvals', { token: fam.parentToken })).body).toHaveLength(0);
    const sib = await complete(fam, item.occurrenceId, kuba.id);
    expect(sib.status).toBe(409);
    expect(sib.body.error).toBe('already_done');
    expect(await balance(kuba.id)).toBe(0);
  });

  it('only parents, only assigned children, only own family', async () => {
    const { fam, ola, kuba } = await setup();
    const other = await registerFamily('Inni');
    await makeTask(fam, [ola.id]);
    const item = await occurrenceFor(ola.token);
    expect((await complete(fam, item.occurrenceId, ola.id, opId(), ola.token)).status).toBe(403);
    expect((await complete(fam, item.occurrenceId, kuba.id)).body.error).toBe('not_assigned');
    expect((await complete(fam, item.occurrenceId, fam.parentId)).body.error).toBe('not_assigned');
    expect((await complete(other, item.occurrenceId, ola.id)).status).toBe(404);
  });
});
