/**
 * Thin wrappers around the GitHub REST API for App-authenticated calls.
 *
 * We avoid pulling Octokit's full plugin tree (it ships a lot of code for a
 * Worker) and instead sign our own installation tokens, then use plain `fetch`.
 *
 * App auth flow:
 *   1. Sign a JWT with the App's private key (RS256) — valid 10 min.
 *   2. Exchange JWT for an installation access token (1 hr) at
 *      POST /app/installations/{installation_id}/access_tokens.
 *   3. Use that token as `Authorization: Bearer ...` for API calls.
 *
 * Why node:crypto and not webcrypto?
 *   GitHub Apps issue private keys in PKCS#1 (-----BEGIN RSA PRIVATE KEY-----),
 *   but WebCrypto's importKey only accepts PKCS#8. node:crypto auto-detects
 *   both, so we use it via the nodejs_compat flag (set in wrangler.toml).
 */

import { createPrivateKey, createSign, type KeyObject } from 'node:crypto';

export interface AppCreds {
  appId: string;
  privateKeyPem: string;
}

interface InstallationToken {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<number, InstallationToken>();
let cachedKey: KeyObject | null = null;
let cachedKeyPem: string | null = null;

function loadKey(pem: string): KeyObject {
  if (cachedKey && cachedKeyPem === pem) return cachedKey;
  cachedKey = createPrivateKey({ key: pem, format: 'pem' });
  cachedKeyPem = pem;
  return cachedKey;
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Build the JWT used to authenticate AS the App (not an installation). */
function signAppJwt(creds: AppCreds): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: creds.appId,
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = loadKey(creds.privateKeyPem);
  const sig = createSign('RSA-SHA256').update(data).sign(key);
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

/** Get a (cached) installation access token. */
export async function getInstallationToken(
  creds: AppCreds,
  installationId: number,
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const jwt = signAppJwt(creds);
  const r = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'RepoShield/0.1',
      },
    },
  );
  if (!r.ok) {
    throw new Error(`installation token failed: ${r.status} ${await r.text()}`);
  }
  const j = (await r.json()) as { token: string; expires_at: string };
  const tok: InstallationToken = {
    token: j.token,
    expiresAt: new Date(j.expires_at).getTime(),
  };
  tokenCache.set(installationId, tok);
  return tok.token;
}

/** Common API helper. */
async function gh(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'RepoShield/0.1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function postComment(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const r = await gh(token, 'POST', `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    body,
  });
  if (!r.ok) throw new Error(`comment failed: ${r.status} ${await r.text()}`);
}

export async function closeIssue(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  reason: 'not_planned' | 'completed' = 'not_planned',
): Promise<void> {
  const r = await gh(token, 'PATCH', `/repos/${owner}/${repo}/issues/${issueNumber}`, {
    state: 'closed',
    state_reason: reason,
  });
  if (!r.ok) throw new Error(`close failed: ${r.status} ${await r.text()}`);
}

export async function addLabel(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[],
): Promise<void> {
  const r = await gh(token, 'POST', `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    labels,
  });
  // 404 means the issue is gone; ignore. Other errors throw.
  if (!r.ok && r.status !== 404) {
    throw new Error(`label failed: ${r.status} ${await r.text()}`);
  }
}

/** Fetch the actor's profile for drive-by scoring. */
export async function getUser(
  token: string,
  login: string,
): Promise<{
  created_at: string;
  public_repos: number;
  followers: number;
  avatar_url: string;
}> {
  const r = await gh(token, 'GET', `/users/${login}`);
  if (!r.ok) throw new Error(`user fetch failed: ${r.status}`);
  return r.json();
}

/** Count contributor's prior issues+PRs in this repo (cheap via search). */
export async function countPriorContributions(
  token: string,
  owner: string,
  repo: string,
  login: string,
): Promise<number> {
  const q = encodeURIComponent(`repo:${owner}/${repo} author:${login}`);
  const r = await gh(token, 'GET', `/search/issues?q=${q}&per_page=1`);
  if (!r.ok) return 0;
  const j = (await r.json()) as { total_count: number };
  // Subtract 1 to exclude the event we're currently processing.
  return Math.max(0, j.total_count - 1);
}
