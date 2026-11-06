# Blockfisher accuracy lab

An in-house test of one question: **how often does the token scanner call a token safe that then goes bad?**

It is kept fully apart from the live products. It has its own database and its own Render services, it never calls the live server, and it never logs real users' scans.

## What it does, once a day

1. **Picks 50 new tokens** from GeckoTerminal's newly created pools: 25 on Solana, 10 on Base, 10 on BNB Chain and 5 on Ethereum. It skips pools under $5,000 of liquidity, and it skips the coin a token is paired with (SOL, WETH, USDC and so on).
2. **Scores each token with the live scanner's own code.** At build time, `scripts/fetch-v2.sh` pulls `blockfisher-token-scanner-v2` from its main branch into `vendor/v2`, so the lab always scores tokens the same way the live scanner does. Each row records which v2 commit scored it. Only Security and Foundation run. Community and X calls are never made.
3. **Checks back at 7 and 30 days**, using the same code, and records what happened:

| Outcome | Rule | Went bad? |
| --- | --- | --- |
| honeypot | The sell test now fails | Yes |
| tax | A sell or transfer tax over 50% | Yes |
| paused | Trading is switched off | Yes |
| takeover | The creator can now take tokens, which the scan didn't show | Yes |
| collapsed | Liquidity is down to 10% or less, or the token no longer trades | You decide: **Rug** (yes) or **Faded** (no) |
| fine | None of the above | No |
| unknown | The sources didn't answer, even after 3 tries | Left out |

**Called safe** means a Security score of 80 or more, with no forced 0.

## The report

The report service shows the wrong-safe rate at 7 and 30 days, split by chain and by v2 version. It also shows the false-alarm rate and a list of misses, where you mark each collapsed pool Rug or Faded. Your browser asks for a password, which is `ADMIN_PASSWORD` (any user name works).

## Setting it up on Render

1. In Render, click **New > Blueprint** and pick this repo. `render.yaml` creates the daily cron job, the report page and a small Postgres database.
2. Set `ADMIN_PASSWORD` on **accuracy-lab-report**.
3. Optional: set `MIN_LIQUIDITY_USD` on the cron job to change the $5,000 floor.

Nothing on the live v2 service changes.

## Limits

- **Holder checks don't run.** These are the experimental checks that come from InsightX, which needs the live server's key. Everything else in Security runs, including the sell test, taxes and owner powers.
- **CoinGecko** is called without a key, so Foundation's exchange-listing hints can be rate-limited on busy days.
- **Rug or faded** can't be told apart automatically, which is why collapsed pools come to you.

## Running it locally

```
npm run build          # installs and pulls v2
npm test
DATABASE_URL=... npm run daily
DATABASE_URL=... ADMIN_PASSWORD=... npm start
```
