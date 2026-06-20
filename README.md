# BotShield

> Automatic AI-slop PR/issue blocker for your GitHub repo.

The 2026 AI-bot wave (templated LLM-slop PRs, crypto airdrop spam, fake-contributor PRs farming for token drops) is drowning open-source maintainers. `awesome-mcp-servers` got 2000+ bot PRs in 12 months. `wong2/awesome-mcp-servers` had to close PRs entirely. GitHub hasn't shipped throttling in 2 years.

BotShield is a GitHub App + free Action that auto-classifies and closes:
- LLM-templated PR/issues (embedding similarity vs known-slop corpus)
- Crypto airdrop / token-claim spam (keyword + domain heuristics)
- Drive-by accounts (age < 7d, zero prior PRs, no avatar, identical PR title patterns)

## Status

Day 1 scaffold (2026-06-20). Not production-ready. No Stripe yet. Webhook + classifier only.

## Repo layout

```
/app       Cloudflare Worker — GitHub App webhook handler + classifier
/landing   Vercel static landing page
```

## Day 1 → Day 3 plan

- **Day 1:** Worker webhook for `issues.opened` + `pull_request.opened`, rule-based classifier, auto-close + comment.
- **Day 2:** Vercel landing (botshield.dev), Stripe checkout (3 tiers), GitHub OAuth.
- **Day 3:** Dashboard (blocked log), GitHub Marketplace listing submission, Show HN draft.

## License

MIT (to maximize OSS distribution).
