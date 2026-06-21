# Changelog

All notable changes to RepoShield are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-21

### Added
- Cloudflare Worker entry point (`app/`) — GitHub App webhook receiver with HMAC SHA-256 verification.
- App-as-JWT auth flow (`signAppJwt`) using `node:crypto` for PKCS#1 and PKCS#8 private-key formats.
- Rule-based classifier with 4 spam categories (`crypto_airdrop`, `llm_slop`, `drive_by`, `templated_typo`).
- Positive-signal patterns: crypto-airdrop language, wallet addresses (`0x…`, `bc1…`, `T…`), URL shorteners, GitHub-impersonating typosquats, Telegram/Discord invites, LLM-templated phrasing, emoji density, em-dash density, templated-typo titles, "add to awesome list" PR pattern.
- Negative-signal rescue: fenced code blocks, stack traces, file-with-line refs, semver strings, cross-issue references — capped so spammers can't escape by padding.
- Free GitHub Action (`action/`) — same classifier, no external services, configurable `block-threshold` and `dry-run` inputs.
- 14 classifier tests covering true positives, true negatives, and adversarial padding.
- CI workflow: vitest run + `tsc --noEmit` + action build on every push.

[Unreleased]: https://github.com/Ax1zz/reposhield/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Ax1zz/reposhield/releases/tag/v0.1.0
