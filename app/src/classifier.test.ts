import { describe, expect, it } from 'vitest';
import { classify } from './classifier';

describe('classifier', () => {
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
});
