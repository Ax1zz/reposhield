/**
 * BotShield Worker entry — receives GitHub App webhooks, classifies the event,
 * and (if the verdict says block) closes + comments + labels the issue/PR.
 *
 * Routes:
 *   GET  /              health-check / "it works" page
 *   POST /webhook       GitHub App webhook receiver
 */

import { Hono } from 'hono';
import {
  type BlockLog,
  handleIssueOpened,
  handlePullRequestOpened,
  verifySignature,
} from './webhook';

interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  BOTSHIELD_LOG?: KVNamespace; // optional Day-2 binding
}

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) =>
  c.text(
    [
      'BotShield Worker — alive.',
      '',
      'POST /webhook  → GitHub App webhook',
      '',
      'github.com/botshield/botshield',
    ].join('\n'),
  ),
);

app.post('/webhook', async (c) => {
  const body = await c.req.text();
  const sig = c.req.header('x-hub-signature-256');
  const event = c.req.header('x-github-event');
  const delivery = c.req.header('x-github-delivery') ?? 'unknown';

  const ok = await verifySignature(c.env.GITHUB_WEBHOOK_SECRET, sig ?? null, body);
  if (!ok) return c.text('bad signature', 401);

  const payload = JSON.parse(body);
  const creds = {
    appId: c.env.GITHUB_APP_ID,
    privateKeyPem: c.env.GITHUB_APP_PRIVATE_KEY,
  };

  const logger = c.env.BOTSHIELD_LOG
    ? async (entry: BlockLog) => {
        const key = `evt:${entry.ts}:${delivery}`;
        await c.env.BOTSHIELD_LOG!.put(key, JSON.stringify(entry), {
          expirationTtl: 60 * 60 * 24 * 30, // 30 days
        });
      }
    : undefined;

  try {
    let result: { blocked: boolean } | null = null;
    if (event === 'issues') {
      result = await handleIssueOpened(payload, creds, logger);
    } else if (event === 'pull_request') {
      result = await handlePullRequestOpened(payload, creds, logger);
    } else if (event === 'ping') {
      return c.json({ ok: true, pong: true });
    } else {
      return c.json({ ok: true, ignored: event });
    }
    return c.json({ ok: true, blocked: result?.blocked ?? false });
  } catch (e) {
    console.error('webhook error', delivery, e);
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

export default app;
