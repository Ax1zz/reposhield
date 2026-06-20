/**
 * Webhook verification (HMAC SHA-256) and event handling.
 *
 * GitHub signs every webhook payload with the secret you set when creating
 * the App. We verify by recomputing `sha256=<hex>` and constant-time-comparing.
 */

import {
  type AppCreds,
  addLabel,
  closeIssue,
  countPriorContributions,
  getInstallationToken,
  getUser,
  postComment,
} from './github';
import { classify, renderCloseComment, type Verdict } from './classifier';

export async function verifySignature(
  secret: string,
  signature: string | null,
  body: string,
): Promise<boolean> {
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = signature.slice(7);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const actual = [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (actual.length !== expected.length) return false;
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

interface IssuePayload {
  action: string;
  installation?: { id: number };
  repository: { owner: { login: string }; name: string };
  sender: { login: string; type: string };
  issue: { number: number; title: string; body: string | null; user: { login: string } };
}

interface PRPayload {
  action: string;
  installation?: { id: number };
  repository: { owner: { login: string }; name: string };
  sender: { login: string; type: string };
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    additions: number;
    deletions: number;
    changed_files: number;
    user: { login: string };
    draft: boolean;
  };
}

export interface BlockLog {
  ts: number;
  repo: string;
  number: number;
  kind: 'issue' | 'pull_request';
  author: string;
  verdict: Verdict;
}

export async function handleIssueOpened(
  payload: IssuePayload,
  creds: AppCreds,
  log?: (entry: BlockLog) => Promise<void>,
): Promise<{ blocked: boolean; verdict: Verdict } | null> {
  if (payload.action !== 'opened') return null;
  if (!payload.installation) return null;
  // Never act on bots' own events.
  if (payload.sender.type === 'Bot') return null;

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const number = payload.issue.number;
  const login = payload.issue.user.login;

  const token = await getInstallationToken(creds, payload.installation.id);

  const [user, prior] = await Promise.all([
    getUser(token, login).catch(() => null),
    countPriorContributions(token, owner, repo, login).catch(() => 0),
  ]);

  const verdict = classify(
    {
      login,
      createdAt: user?.created_at,
      publicRepos: user?.public_repos,
      followers: user?.followers,
      hasDefaultAvatar: user ? /identicons?\.github\.com|\?v=\d+$/.test(user.avatar_url) === false ? false : true : undefined,
      priorContributionsToRepo: prior,
    },
    {
      kind: 'issue',
      title: payload.issue.title,
      body: payload.issue.body ?? '',
    },
  );

  if (verdict.block) {
    await postComment(token, owner, repo, number, renderCloseComment(verdict));
    await closeIssue(token, owner, repo, number, 'not_planned');
    await addLabel(token, owner, repo, number, ['botshield/spam']);
  }

  await log?.({
    ts: Date.now(),
    repo: `${owner}/${repo}`,
    number,
    kind: 'issue',
    author: login,
    verdict,
  });

  return { blocked: verdict.block, verdict };
}

export async function handlePullRequestOpened(
  payload: PRPayload,
  creds: AppCreds,
  log?: (entry: BlockLog) => Promise<void>,
): Promise<{ blocked: boolean; verdict: Verdict } | null> {
  if (payload.action !== 'opened') return null;
  if (!payload.installation) return null;
  if (payload.sender.type === 'Bot') return null;
  if (payload.pull_request.draft) return null;

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const number = payload.pull_request.number;
  const login = payload.pull_request.user.login;

  const token = await getInstallationToken(creds, payload.installation.id);

  const [user, prior] = await Promise.all([
    getUser(token, login).catch(() => null),
    countPriorContributions(token, owner, repo, login).catch(() => 0),
  ]);

  const verdict = classify(
    {
      login,
      createdAt: user?.created_at,
      publicRepos: user?.public_repos,
      followers: user?.followers,
      hasDefaultAvatar: undefined, // identicon detection is unreliable; skip.
      priorContributionsToRepo: prior,
    },
    {
      kind: 'pull_request',
      title: payload.pull_request.title,
      body: payload.pull_request.body ?? '',
      additions: payload.pull_request.additions,
      deletions: payload.pull_request.deletions,
      filesChanged: payload.pull_request.changed_files,
    },
  );

  if (verdict.block) {
    await postComment(token, owner, repo, number, renderCloseComment(verdict));
    await closeIssue(token, owner, repo, number, 'not_planned');
    await addLabel(token, owner, repo, number, ['botshield/spam']);
  }

  await log?.({
    ts: Date.now(),
    repo: `${owner}/${repo}`,
    number,
    kind: 'pull_request',
    author: login,
    verdict,
  });

  return { blocked: verdict.block, verdict };
}
