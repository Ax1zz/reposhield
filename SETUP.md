# BotShield — first-day setup checklist

Everything you (the human) have to do manually outside the codebase. ~45 min total, **$0**.

## 1. GitHub App registration (5 min)

1. Go to https://github.com/settings/apps/new
2. Fill in:
   - **Name:** `BotShield` (must be globally unique; if taken, try `BotShield Cloud`).
   - **Homepage URL:** `https://botshield.dev` (set later — use a placeholder).
   - **Webhook URL:** `https://botshield.<your-cf-subdomain>.workers.dev/webhook` (you'll fill this after deploying the Worker; for now use any HTTPS URL).
   - **Webhook secret:** generate with `openssl rand -hex 32` → save it.
   - **Repository permissions:** Issues (R/W), Pull requests (R/W), Metadata (R), Contents (R).
   - **Subscribe to events:** Issues, Pull request.
   - **Where:** Any account.
3. After creation:
   - Copy **App ID** (numeric, top of the page).
   - **Generate a private key** → downloads a `.pem` file. Keep it.

## 2. Cloudflare Worker deploy (10 min, free tier)

```bash
cd app
npm install
npx wrangler login
# Set the three secrets:
npx wrangler secret put GITHUB_APP_ID                # paste App ID
npx wrangler secret put GITHUB_WEBHOOK_SECRET        # paste the openssl-generated one
npx wrangler secret put GITHUB_APP_PRIVATE_KEY       # paste full PEM contents incl. headers
npm run deploy
```

Output gives you `https://botshield.<subdomain>.workers.dev`. Paste that + `/webhook` back into the GitHub App's webhook URL field.

Test: open https://botshield.<subdomain>.workers.dev/ → you should see "BotShield Worker — alive."

## 3. Action repository (5 min)

1. Create public GitHub org `botshield` (free).
2. Create public repo `botshield/action`.
3. Push the `action/` folder contents into it.
4. `cd action && npm install && npm run build` → commits `dist/index.js`.
5. Tag `v1` → `git tag v1 && git push --tags`.

Now any repo on Earth can use `uses: botshield/action@v1`.

## 4. Landing on Vercel (10 min, free)

1. Create another public repo `botshield/landing`, push `landing/` contents.
2. Connect to Vercel: https://vercel.com/new → import repo → framework "Other" → root `./` → deploy.
3. Add custom domain `botshield.dev` (buy from Cloudflare Registrar ≈ $11/yr — that's the **only** required spend, optional for Day 1).
4. For free email collection: register at https://formspree.io (free 50 submissions/mo) → replace `YOUR_FORM_ID` in `landing/index.html`.

For Day 1 you can launch on `botshield-landing.vercel.app` — domain is a polish step.

## 5. Self-test (5 min)

In a sandbox repo you own:
1. Install your BotShield App (Settings → Developer settings → GitHub Apps → BotShield → Install App).
2. Open a test issue titled `$CLAW airdrop is live` with body `Connect your wallet at token-claw.xyz`.
3. Watch BotShield auto-close it with a verdict comment within ~3 seconds.
4. Open a normal issue: `App crashes on macOS` → should stay open.

## 6. Distribution (Day 1 evening)

- Push to https://github.com/botshield/botshield (private at first if shy, public for traction).
- Draft Show HN: title **`Show HN: BotShield — automatic AI-slop PR/issue blocker for your GitHub repo`**. Don't post until you have one paying user OR one big-repo install for the screenshot.
- Comment in:
  - https://github.com/orgs/community/discussions/174283 (Git Coin SPAM)
  - https://github.com/orgs/community/discussions/107248 (GitHub spam in general)
  - https://news.ycombinator.com/item?id=48181125 (the `git --author` flag DIY)
  Format: *"Hit the same problem; built [BotShield](https://github.com/botshield/action) as an open Action. Free; would love feedback."* No DMs.

## What is **not** in Day 1

- Stripe → Day 2.
- Dashboard → Day 2.
- Embedding-based classifier → Day 2 (rules only for now).
- GitHub Marketplace listing → Day 3 (after you have ≥10 stars and a screenshot).
- Custom slop corpus → Day 3+.
