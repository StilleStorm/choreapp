// Creates the demo family on a local or test API (never production):
//   node scripts/demo-family.mjs http://localhost:8787
// Admin: mama@example.com / haslo-12345, adult tata@example.com / haslo-12345,
// children Zosia and Kuba (no phone; use "Przełącz na konto dziecka").
const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
const PASSWORD = 'haslo-12345';

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

let token;
try {
  ({ token } = await call('POST', '/v1/auth/register', {
    familyName: 'Rodzina Demo',
    parentName: 'Mama',
    email: 'mama@example.com',
    password: PASSWORD,
    timezone: 'Europe/Warsaw',
  }));
} catch (e) {
  if (!String(e).includes('email_taken')) throw e;
  console.log('Demo family already exists.');
  process.exit(0);
}
for (const name of ['Zosia', 'Kuba']) {
  try {
    await call('POST', '/v1/members', { name }, token); // 1.0.16+: a child without a phone
  } catch (e) {
    if (!String(e).includes(': 404')) throw e;
    const inv = await call('POST', '/v1/invites', { role: 'child' }, token); // older API
    await call('POST', '/v1/invites/redeem', { code: inv.code, name });
  }
}
const inv = await call('POST', '/v1/invites', { role: 'parent' }, token);
await call('POST', '/v1/invites/redeem', { code: inv.code, name: 'Tata', email: 'tata@example.com', password: PASSWORD });
console.log(`Demo family ready on ${base}: mama@example.com / ${PASSWORD}`);
