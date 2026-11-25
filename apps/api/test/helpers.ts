import { env } from 'cloudflare:workers';
import { app } from '../src/index.js';

export { env };

/** E-mails "sent" through the fake EMAIL binding; `failEmail` makes the next sends throw. */
export const sentEmails: EmailMessageBuilder[] = [];
export const emailControl = { fail: false };
const fakeEmail = {
  async send(message: EmailMessageBuilder) {
    if (emailControl.fail) throw Object.assign(new Error('send failed'), { code: 'E_TEST' });
    sentEmails.push(message);
    return { messageId: `test-${sentEmails.length}` };
  },
} as unknown as SendEmail;
const testEnv = Object.assign(Object.create(env), { EMAIL: fakeEmail }) as typeof env;

export interface Res<T = any> {
  status: number;
  body: T;
}

export async function call<T = any>(
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; raw?: BodyInit; contentType?: string; ip?: string } = {},
): Promise<Res<T>> {
  const headers = new Headers();
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);
  if (opts.json !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.contentType) headers.set('Content-Type', opts.contentType);
  headers.set('CF-Connecting-IP', opts.ip ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`);
  const res = await app.request(
    `http://api.test${path}`,
    { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.raw },
    testEnv,
  );
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}

let counter = 0;
export function uniqueEmail(): string {
  return `parent${Date.now()}${counter++}@example.com`;
}

export interface Family {
  parentToken: string;
  parentId: string;
  familyId: string;
  email: string;
}

export async function registerFamily(name = 'Kowalscy'): Promise<Family> {
  const email = uniqueEmail();
  const r = await call('POST', '/v1/auth/register', {
    json: { familyName: name, parentName: 'Mama', email, password: 'tajne-haslo-123' },
  });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
  return { parentToken: r.body.token, parentId: r.body.me.id, familyId: r.body.family.id, email };
}

export async function addChild(fam: Family, name = 'Ola'): Promise<{ token: string; id: string }> {
  const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
  const r = await call('POST', '/v1/invites/redeem', { json: { token: inv.body.token, name } });
  if (r.status !== 201) throw new Error(`redeem failed: ${JSON.stringify(r.body)}`);
  return { token: r.body.token, id: r.body.me.id };
}
