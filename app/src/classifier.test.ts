import { describe, expect, it } from 'vitest';
import { classify } from './classifier';

describe('classifier — true positives (must block)', () => {
  it('blocks crypto-airdrop spam outright', () => {
    const v = classify(
      { login: 'spammer', priorContributionsToRepo: 0 },
      {
        kind: 'issue',
        title: '$CLAW airdrop is live — claim your tokens now',
        body: 'Connect your wallet at https://token-claw.xyz to claim your rewards',
      },
    );
    expect(v.block).toBe(true);
    expect(v.primaryCategory).toBe('crypto_airdrop');
  });

  it('blocks issue containing a crypto wallet address', () => {
    const v = classify(
      { login: 'drop_farmer', priorContributionsToRepo: 0, followers: 0, publicRepos: 0 },
      {
        kind: 'issue',
        title: 'Help me with your project',
        body: 'Please send rewards to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e — much appreciated!',
      },
    );
    expect(v.block).toBe(true);
  });

  it('blocks GitHub-typosquat domain even without other crypto words', () => {
    const v = classify(
      { login: 'phisher', priorContributionsToRepo: 0 },
      {
        kind: 'issue',
        title: 'Account security update required',
        body: 'Please verify at https://github-claim.io/reposhield within 24 hours.',
      },
    );
    expect(v.block).toBe(true);
    expect(v.primaryCategory).toBe('crypto_airdrop');
  });

  it('blocks LLM-slop PR from a fresh account with one-line typo fix', () => {
    const v = classify(
      {
        login: 'newbie',
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        publicRepos: 0,
        followers: 0,
        priorContributionsToRepo: 0,
      },
      {
        kind: 'pull_request',
        title: 'docs: fix typo',
        body: 'I noticed an issue and would like to contribute. This pull request aims to improve the project.',
        additions: 1,
        deletions: 1,
        filesChanged: 1,
      },
    );
    expect(v.block).toBe(true);
  });

  it('blocks AI-slop body without obvious phrases via emoji + em-dash density', () => {
    const v = classify(
      {
        login: 'gpt_kid',
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        publicRepos: 0,
        followers: 0,
        priorContributionsToRepo: 0,
      },
      {
        kind: 'pull_request',
        title: 'Enhancement',
        body:
          'I have analyzed the codebase 🚀 — there are several opportunities ✨ to improve maintainability — and I would be happy to help — here is a breakdown of the changes I propose 💎.',
        additions: 4,
        deletions: 2,
        filesChanged: 1,
      },
    );
    expect(v.block).toBe(true);
  });

  it('blocks "add X to awesome list" PR from a zero-history account', () => {
    const v = classify(
      {
        login: 'drop_hunter',
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        publicRepos: 0,
        followers: 0,
        priorContributionsToRepo: 0,
      },
      {
        kind: 'pull_request',
        title: 'Add my-cool-mcp to awesome list',
        body: 'See https://my-cool-mcp.example',
        additions: 1,
        deletions: 0,
        filesChanged: 1,
      },
    );
    expect(v.block).toBe(true);
  });

  it('blocks when all referenced URLs are shorteners', () => {
    const v = classify(
      { login: 'redirector', priorContributionsToRepo: 0, followers: 0, publicRepos: 0 },
      {
        kind: 'issue',
        title: 'Cool drop incoming',
        body: 'check it: https://bit.ly/3xQ and https://cutt.ly/abc — exclusive drop for early supporters',
      },
    );
    expect(v.block).toBe(true);
  });

  it('blocks Telegram-invite spam in issue', () => {
    const v = classify(
      { login: 'tg_pusher', priorContributionsToRepo: 0, followers: 0, publicRepos: 0 },
      {
        kind: 'issue',
        title: 'Join our trading group',
        body: 'Free signals daily, join https://t.me/joinchat_xyz_secret — limited slots',
      },
    );
    expect(v.block).toBe(true);
  });
});

describe('classifier — true negatives (must NOT block)', () => {
  it('passes a legitimate-looking PR from an established contributor', () => {
    const v = classify(
      {
        login: 'maintainer-friend',
        createdAt: '2018-04-01T00:00:00Z',
        publicRepos: 42,
        followers: 200,
        priorContributionsToRepo: 7,
      },
      {
        kind: 'pull_request',
        title: 'Fix race condition in worker shutdown',
        body: 'Reproduces deterministically with seed 42. See test added in src/worker.test.ts.',
        additions: 35,
        deletions: 12,
        filesChanged: 3,
      },
    );
    expect(v.block).toBe(false);
    expect(v.primaryCategory).toBe('clean');
  });

  it('does not block on drive-by signals alone (avoid false positives)', () => {
    const v = classify(
      {
        login: 'newbie',
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        publicRepos: 0,
        followers: 0,
        priorContributionsToRepo: 0,
      },
      {
        kind: 'issue',
        title: 'App crashes when I click the export button on macOS Sonoma',
        body: 'Steps: 1) open app 2) load 100MB csv 3) click Export → segfault. Logs attached.',
      },
    );
    expect(v.block).toBe(false);
  });

  it('rescues a fresh-account bug report by stack trace + file:line refs', () => {
    const v = classify(
      {
        login: 'first_time_reporter',
        createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
        publicRepos: 0,
        followers: 0,
        priorContributionsToRepo: 0,
      },
      {
        kind: 'issue',
        title: 'Improvements', // intentionally matches a boilerplate title pattern
        body:
          'On startup the worker throws:\n\n```\nUncaught TypeError: cannot read properties of undefined (reading "id")\n    at Worker.start (src/worker.ts:42:18)\n    at main (src/main.ts:11:3)\n```\n\nNode v20.10.0, see also #128.',
      },
    );
    expect(v.block).toBe(false);
  });

  it('does not block a one-line PR from a fresh account when it contains test changes', () => {
    // This test guards a specific pattern we care about: a real contributor's
    // tiny first PR. We rely on the file:line marker pulling them under the line.
    const v = classify(
      {
        login: 'shy_dev',
        createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
        publicRepos: 1,
        followers: 0,
        priorContributionsToRepo: 0,
      },
      {
        kind: 'pull_request',
        title: 'fix: off-by-one in src/range.ts:88',
        body: 'Test added: src/range.test.ts#L12-L25. Fixes #214.',
        additions: 8,
        deletions: 1,
        filesChanged: 2,
      },
    );
    expect(v.block).toBe(false);
  });
});

describe('classifier — adversarial cases', () => {
  it('still blocks crypto-spam padded with a fake code block (cap on negative)', () => {
    const v = classify(
      { login: 'sneaky', priorContributionsToRepo: 0, followers: 0, publicRepos: 0 },
      {
        kind: 'issue',
        title: 'Claim your USDT airdrop now',
        body:
          'Send a tx to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n\n```\nGENERIC CODE BLOCK\n```\n\nSee src/foo.ts:1 — Node v20.\n\nReferences: #1',
      },
    );
    expect(v.block).toBe(true);
    expect(v.primaryCategory).toBe('crypto_airdrop');
  });

  it('reports a clean verdict with primaryCategory=clean when nothing fires', () => {
    const v = classify(
      {
        login: 'quiet_user',
        createdAt: '2020-01-01T00:00:00Z',
        publicRepos: 10,
        followers: 5,
        priorContributionsToRepo: 2,
      },
      {
        kind: 'issue',
        title: 'Question about configuring the cache TTL',
        body: 'Is there a way to tune cacheLife per route? The docs only show the default.',
      },
    );
    expect(v.block).toBe(false);
    expect(v.primaryCategory).toBe('clean');
  });
});
