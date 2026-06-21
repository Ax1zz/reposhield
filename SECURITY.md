# Security Policy

## Reporting a vulnerability

Open a [private security advisory](https://github.com/Ax1zz/reposhield/security/advisories/new), or email `ax1zzdev@proton.me` with `[RepoShield security]` in the subject.

Please **do not** open a public issue for security reports.

## Scope

The following are considered in-scope:

- Webhook signature bypass in `app/src/webhook.ts:verifySignature`.
- Token-handling issues in `app/src/github.ts` (installation token cache, JWT signing).
- Classifier evasion that lets a spammer reach `state: open` deterministically (e.g. zero-width-character bypass, ReDoS in pattern lists).
- Action-level token leakage (`action/src/index.ts`).

The following are **not** in-scope:

- Classifier false positives or false negatives on a *single* sample. Those go to a normal issue with a sample, so they become a test case.
- Cloudflare or GitHub platform vulnerabilities — report those to the respective vendor.

## Disclosure timeline

- Acknowledgement within 72 hours.
- Patch and advisory within 14 days for high-severity reports, 30 days otherwise.
- Public credit unless you ask for anonymity.
