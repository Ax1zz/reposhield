# BotShield Action

Free GitHub Action that blocks AI-slop PRs/issues and crypto-airdrop spam on your repo.

For the always-on, repo-wide variant (no workflow file required, with dashboard), install the [BotShield GitHub App](https://botshield.dev).

## Quick start

Create `.github/workflows/botshield.yml`:

```yaml
name: BotShield
on:
  issues:
    types: [opened]
  pull_request_target:
    types: [opened]

permissions:
  issues: write
  pull-requests: write

jobs:
  shield:
    runs-on: ubuntu-latest
    steps:
      - uses: botshield/action@v1
        with:
          block-threshold: '0.6'
          dry-run: 'false'
```

Use `pull_request_target` (not `pull_request`) so the workflow has write access to the PR even from forks. This is intentional and safe here — BotShield only reads metadata, never checks out untrusted code.

## Inputs

| Input | Default | Description |
|---|---|---|
| `github-token` | `${{ github.token }}` | Token with `issues: write` + `pull-requests: write`. |
| `block-threshold` | `0.6` | Verdict score (0..1) at which to close. Raise for fewer false positives. |
| `dry-run` | `false` | If `true`, only comments the verdict; never closes. |

## License

MIT.
