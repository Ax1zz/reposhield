# Contributing

Patches and reports are welcome. The classifier is the heart of the project — adding a real-world slop pattern that RepoShield missed is the highest-value contribution.

## Reporting spam RepoShield missed

Open an issue with:

- The original PR or issue (link, or paste title + body if it's been deleted).
- Author signals (account age, prior PRs, follower count) if known.
- Why you think it should have been blocked.

That sample becomes a test case in `app/src/classifier.test.ts`.

## Reporting a false positive

Open an issue with the same info, plus the verdict comment RepoShield left. The maintainer-reopen path will eventually train the classifier on overrides — today we hand-tune.

## Code changes

```bash
cd app
npm install
npm test
npm run typecheck
```

Rules of thumb when extending the classifier:

- **Add a test first.** Each new positive pattern needs a true-positive case, and ideally one true-negative that the pattern *almost* matches but shouldn't.
- **Negative signals are sacred.** They protect real bug reports. Don't add positive weights that overwhelm `STACK_TRACE_RE` or `FILE_LINE_RE`.
- **Don't bump weights without rerunning all tests.** A 0.05 nudge in one place can flip a borderline test.

## Style

- TypeScript, strict mode. No `any` unless escaping a foreign type.
- Plain `fetch` over Octokit — keeps the Worker bundle small.
- Comment only where the *why* is non-obvious. Names should carry the *what*.

## Releases

Tagged `v0.x.0` on the default branch. Action consumers pin to a tag (`Ax1zz/reposhield/action@v0.1.0`).
