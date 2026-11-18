# Dip-Catch + Stand-Down — cbBTC trading bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/hrd04-ai/btc-race-24h-20261118/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/hrd04-ai/btc-race-24h-20261118/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

Entry for make.fun **btc-race-24h-20261118-1444** ("Race a BTC trading bot live for 24 hours").

A long-only bot that trades Coinbase Wrapped BTC (cbBTC) against USDC on
1-minute on-chain bars, starting with $1,000 of paper money. It stays in
cash, strikes only after a sharp one-hour drop (close ≥ 1.60% below the
close 60 bars ago), takes the bounce at +1.20%, caps a failed strike with
a 1.50% trailing stop, and stands down for the rest of the window the
moment a round trip loses money. If no dip ever comes by bar 720 it buys
once anyway, so the entry always makes at least one trade.

## Files

- `main.ts` — the bot (Node 22, `agent-fun/bars-replay/v1` via the kit SDK shim)
- `vendor/makefun-bars.ts` — byte copy of the kit's SDK shim
- `STRATEGY.md` — what was tested, what was rejected, and the numbers
- `LICENSE` — MIT

## Local grade

From the competition kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot /path/to/this/repo --driver process
```

Dev-window result (official local grade): **+$16.37 net PnL, 4 trades, max drawdown 1.12%** — clears the dev gate (net PnL > $0).

## Strategy in one paragraph

On a falling day the only way to make money long-only is to buy sharp
dips and sell the bounce quickly; holding through the decline loses, and
trading often bleeds to the ~26 bps round-trip cost. This bot does exactly
two disciplined things: it buys a 1.6% hourly drop and sells the 1.2%
bounce, and it quits for the day after one losing strike, because a failed
dip-buy means the day is a grind, not a reversion.
