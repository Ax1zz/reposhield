/**
 * BotShield Action entry — same classifier as the cloud Worker, run as a
 * GitHub Action from each repo's workflow. No external services.
 *
 * Reads the event payload from $GITHUB_EVENT_PATH, the event name from
 * $GITHUB_EVENT_NAME, and a GitHub token from the action input.
 */

import { readFileSync } from 'node:fs';
import { classify, renderCloseComment } from '../../app/src/classifier';

interface Repo {
  owner: { login: string };
  name: string;
}
interface User {
  login: string;
}
interface IssueEvent {
  action: string;
  repository: Repo;
  sender: { login: string; type: string };
  issue: { number: number; title: string; body: string | null; user: User };
}
interface PREvent {
  action: string;
  repository: Repo;
  sender: { login: string; type: string };
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    user: User;
    draft: boolean;
    additions: number;
    deletions: number;
    changed_files: number;
  };
}

function input(name: string, fallback = ''): string {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] ?? fallback;
}

async function gh(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'BotShield-Action/0.1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`);
  return r;
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const token = input('github-token');
  const threshold = parseFloat(input('block-threshold', '0.6'));
  const dryRun = input('dry-run', 'false').toLowerCase() === 'true';

  if (!eventPath || !eventName || !token) {
    console.log('BotShield: missing event context, skipping.');
    return;
  }

  const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
  if (payload.action !== 'opened') {
    console.log(`BotShield: ignoring action=${payload.action}`);
    return;
  }
  if (payload.sender?.type === 'Bot') {
    console.log('BotShield: ignoring Bot sender.');
    return;
  }

  let kind: 'issue' | 'pull_request';
  let number: number;
  let title: string;
  let body: string;
  let login: string;
  let additions: number | undefined;
  let deletions: number | undefined;
  let filesChanged: number | undefined;

  if (eventName === 'issues') {
    const e = payload as IssueEvent;
    kind = 'issue';
    number = e.issue.number;
    title = e.issue.title;
    body = e.issue.body ?? '';
    login = e.issue.user.login;
  } else if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    const e = payload as PREvent;
    if (e.pull_request.draft) {
      console.log('BotShield: ignoring draft PR.');
      return;
    }
    kind = 'pull_request';
    number = e.pull_request.number;
    title = e.pull_request.title;
    body = e.pull_request.body ?? '';
    login = e.pull_request.user.login;
    additions = e.pull_request.additions;
    deletions = e.pull_request.deletions;
    filesChanged = e.pull_request.changed_files;
  } else {
    console.log(`BotShield: ignoring event ${eventName}`);
    return;
  }

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;

  // Fetch author profile + prior contributions for drive-by scoring.
  let createdAt: string | undefined;
  let publicRepos = 0;
  let followers = 0;
  try {
    const u = await (await gh(token, 'GET', `/users/${login}`)).json() as {
      created_at: string; public_repos: number; followers: number;
    };
    createdAt = u.created_at;
    publicRepos = u.public_repos;
    followers = u.followers;
  } catch {}

  let priorContributionsToRepo = 0;
  try {
    const q = encodeURIComponent(`repo:${owner}/${repo} author:${login}`);
    const j = await (await gh(token, 'GET', `/search/issues?q=${q}&per_page=1`)).json() as {
      total_count: number;
    };
    priorContributionsToRepo = Math.max(0, j.total_count - 1);
  } catch {}

  const verdict = classify(
    { login, createdAt, publicRepos, followers, priorContributionsToRepo },
    { kind, title, body, additions, deletions, filesChanged },
  );

  console.log('BotShield verdict:', JSON.stringify(verdict));

  if (verdict.score < threshold) {
    console.log(`BotShield: score ${verdict.score.toFixed(2)} < threshold ${threshold}; not blocking.`);
    return;
  }

  await gh(token, 'POST', `/repos/${owner}/${repo}/issues/${number}/comments`, {
    body: renderCloseComment(verdict) + (dryRun ? '\n\n_(dry-run mode: not closed)_' : ''),
  });

  if (!dryRun) {
    await gh(token, 'PATCH', `/repos/${owner}/${repo}/issues/${number}`, {
      state: 'closed',
      state_reason: 'not_planned',
    });
    await gh(token, 'POST', `/repos/${owner}/${repo}/issues/${number}/labels`, {
      labels: ['botshield/spam'],
    }).catch(() => {}); // label create may 404; swallow
  }

  console.log(`BotShield: ${dryRun ? 'commented (dry-run)' : 'closed'} ${kind} #${number}`);
}

main().catch((e) => {
  console.error('BotShield action failed:', e);
  process.exit(1);
});
