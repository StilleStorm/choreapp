import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings, Env } from './env.js';
import { requireAuth } from './lib/auth.js';
import { ApiError } from './lib/http.js';
import { account, publicAccount } from './routes/account.js';
import { appRelease } from './routes/app.js';
import { files } from './routes/files.js';
import { invites, publicInvites } from './routes/invites.js';
import { passwordReset } from './routes/passwordReset.js';
import { points } from './routes/points.js';
import { reviews } from './routes/reviews.js';
import { shop } from './routes/shop.js';
import { tasks } from './routes/tasks.js';
import { runCron } from './services/cron.js';

export const app = new Hono<AppBindings>();

// The app runs in a Capacitor WebView (origin https://localhost) and sends a
// bearer token, never cookies, so any origin may call the API.
app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], maxAge: 86400 }));

app.get('/', (c) => c.json({ name: 'choreapp-api', ok: true }));

// Everything mounted on `authed` requires a session. Public routes are
// registered first so they answer before the auth middleware runs.
const authed = new Hono<AppBindings>().use(requireAuth).route('/', invites).route('/', account).route('/', tasks).route('/', reviews).route('/', points).route('/', shop).route('/', appRelease);

const v1 = new Hono<AppBindings>()
  .route('/', files)
  .route('/', publicAccount)
  .route('/', passwordReset)
  .route('/', publicInvites)
  .route('/', authed);

app.route('/v1', v1);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.code, message: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

export async function scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  await runCron(env, controller.scheduledTime);
}

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;
