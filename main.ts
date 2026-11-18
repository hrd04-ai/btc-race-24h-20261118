// Dip-Catch + Stand-Down — a long-only cbBTC bot for make.fun's
// btc-race-24h-20261118-1444 (agent-fun/bars-replay/v1).
//
// The dev window this bot was built for is a falling day: BTC opens at
// $65,083, drops 2.5% in the first two hours, rebounds 1.9% to $65,190
// around midnight, then grinds down to close at $63,261 (-2.80%). One-minute
// noise is ~6.7 bps and a full-size round trip costs ~26 bps (4 bps fee +
// 2 bps slippage + ~7 bps of constant-product impact each way at $1,000
// against ~$1M of pool depth), so a trade has to catch a move bigger than
// that just to break even. The previous round's winner (buy the first
// pullback, hold with a wide trail) loses $27.68 on this window — it rides
// the whole decline — and the house ema-cross baseline loses far more, so
// this bot is built the other way round: stay in cash, strike only when the
// market has already fallen hard, take the bounce quickly, and stand down
// the moment a strike loses money.
//
//   1. Dip entry. Buy the whole cash balance when the close is at least
//      1.60% below the close 60 bars ago — a sharp one-hour drop. A 1.6%
//      hourly drop is ~5 standard deviations of the 60-bar return on this
//      window, so it fires rarely (twice on the dev window) and only after
//      real selling, not on ordinary chop. The buy fills at the next bar's
//      open, so the bot is catching the drop's aftermath, not the knife's
//      edge: on the dev window the two entries land at $64,000 and $63,900
//      and both bounce.
//   2. Quick take-profit. Sell everything when the close is 1.20% above
//      the entry close. The window's real bounces run 1.6-1.9% from their
//      lows; 1.20% takes most of one while leaving room for the fill to
//      land a minute later at the next open. A round trip that captures
//      1.20% pays ~0.26% in costs and keeps ~0.94%.
//   3. Trailing stop. Sell everything when the close falls 1.50% below
//      the highest close since entry. If the bounce never comes, the loss
//      is capped near 1.5% plus costs instead of riding a grind down.
//      Once the position is 0.60% in profit the trail tightens to 0.80%,
//      so a working bounce keeps more of its gain on a sharp reversal.
//   4. Stand down after a loss. If a round trip ends with less cash than
//      the bot had before the buy — judged exactly, from the fills and the
//      cash balance, not from a mark — the bot stops trading for the rest
//      of the window. One failed dip-buy is evidence the day is a
//      falling-knife grind rather than a reverting dip, and a second strike
//      into the same grind is how the dip-buying family loses $32 on the
//      previous round's -4% day; standing down bounds that day to about
//      -$14 instead. At most two entries per window in any case.
//   5. Fallback anchor. If no dip ever comes by bar 720 (half the
//      window), buy once anyway, with the same take-profit and trailing
//      stop. This guarantees the race guardrail (>= 1 trade) on a trend
//      day with no sharp drops: on the dev window time-reversed (an
//      uptrend day) the fallback rides the second half up for +$9.57.
//      On the dev window itself the dip entries fire long before bar 720,
//      so the fallback never triggers there.
//
// Sizing is full cash per entry, one position, 1% max slippage per order.
// Every decision is a deterministic function of the closes and fills seen
// so far (float64 arithmetic on integer prices only — no wall clock, no
// randomness, no network, no files), so two executions on the same data
// produce the same orders.
//
// Local replay (an exact-fill simulator mirroring the harness, verified to
// the cent against grade-local on the previous round):
//   new dev window  +$16.37 (4 trades, max DD 1.12%)
//   dev time-reversed (uptrend day)  +$9.57 (2 trades, fallback)
//   previous dev window (20261117, +0.49% day)  +$8.90
//   previous dev window (20261115, -4% grind day)  -$14.14 (stood down)
//   dev block-shuffled, 2 seeds  -$12.81 / -$17.56 (noise days: the cost
//     of striking at random drops, bounded by the stand-down rule)

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Max slippage past the close the order was decided on (1%). */
const MAX_SLIPPAGE_BPS = 100;
/** Dip entry: the close must be this far below the close 60 bars ago. */
const DROP_BPS = 160;
/** Take-profit above the entry close. */
const TAKE_PROFIT_BPS = 120;
/** Trailing stop below the highest close since entry. */
const TRAIL_BPS = 150;
/** Once the position is this far above the entry close, the trailing
 *  stop tightens to LOCK_TRAIL_BPS: a bounce that is already working
 *  keeps more of its gain if it reverses sharply. Verified neutral on
 *  every window tested (dev, reversed, shuffled, both previous dev
 *  windows) — it only bites on a reversal the tests never show. */
const PROFIT_LOCK_BPS = 60;
/** Tightened trailing stop once the profit lock is active. */
const LOCK_TRAIL_BPS = 80;
/** At most this many entries (dip buys + fallback) per window. */
const MAX_ENTRIES = 2;
/** Fallback anchor: buy at this bar index at the latest if no dip came. */
const FALLBACK_BAR = 720;
/** Bars of history the dip signal needs (60-bar return). */
const DROP_LOOKBACK = 60;

/** The bot's state across batches. */
interface BotState {
  /** Closes of CBBTC seen so far (scored bars only). */
  closes: number[];
  /** Close of the bar the current position's buy was decided on. */
  entryClose: number | null;
  /** Highest close since the current entry (the entry close at first). */
  peakSinceEntry: number | null;
  /** Cash before the current position's buy was decided (bigint units). */
  cashBeforeBuy: bigint;
  /** Entries filled so far (dip buys + fallback). */
  entries: number;
  /** A buy was sent on the previous batch and its fill is due this batch. */
  buyPending: string | null;
  /** A sell was sent on the previous batch and its fill is due this batch. */
  sellPending: string | null;
  /** True once a round trip lost money: no more entries this window. */
  stoodDown: boolean;
}

const bot: BotState = {
  closes: [],
  entryClose: null,
  peakSinceEntry: null,
  cashBeforeBuy: 0n,
  entries: 0,
  buyPending: null,
  sellPending: null,
  stoodDown: false,
};

function buyAll(state: BarsState, clientId: string): BuyInput | null {
  const cash = state.cash;
  if (cash <= 0n || cash < BigInt(state.hello.fees.min_notional_quote_units)) return null;
  return { side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: clientId };
}

await runBars({
  onBatch(state, batch: Batch) {
    // Warm-up bars are before the scored window; indicators still read
    // the scored bars only, so the dip signal stays correct either way.
    if (state.warmingUp) return [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];

    // Fold this batch's fills in first: a buy that landed confirms the
    // entry, a sell that landed closes the round trip, and a rejection
    // frees the bot to decide again on this bar.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL) continue;
      if (fill.client_id === bot.buyPending) {
        bot.buyPending = null;
        if (fill.status === 'filled') {
          bot.entries += 1;
          bot.peakSinceEntry = bot.entryClose;
        }
      } else if (fill.client_id === bot.sellPending) {
        bot.sellPending = null;
        if (fill.status === 'filled') {
          // Exact loss check: the sell's proceeds are already in cash.
          // A round trip that ends below the cash held before the buy
          // means the day is a grind, not a reverting dip: stand down.
          if (state.cash < bot.cashBeforeBuy) bot.stoodDown = true;
          bot.entryClose = null;
          bot.peakSinceEntry = null;
        }
      }
    }

    const c = Number(bar.c);
    bot.closes.push(c);
    const barIndex = bot.closes.length - 1;

    const held = state.positions.get(SYMBOL);
    const orders: Array<BuyInput | SellInput> = [];

    if (held !== undefined) {
      if (bot.peakSinceEntry !== null && c > bot.peakSinceEntry) bot.peakSinceEntry = c;
      // Take the bounce, or cap the loss: a sell the market refuses is
      // simply re-sent on the next bar while the exit still holds.
      // Once the trade is 0.60% in profit the trail tightens to 0.80%,
      // so a working bounce keeps more of its gain on a sharp reversal.
      const takeProfit =
        bot.entryClose !== null && c >= bot.entryClose * (1 + TAKE_PROFIT_BPS / 10_000);
      const profitLocked =
        bot.entryClose !== null && c >= bot.entryClose * (1 + PROFIT_LOCK_BPS / 10_000);
      const effTrailBps = profitLocked ? LOCK_TRAIL_BPS : TRAIL_BPS;
      const stoppedOut =
        bot.peakSinceEntry !== null && c < bot.peakSinceEntry * (1 - effTrailBps / 10_000);
      if ((takeProfit || stoppedOut) && bot.sellPending === null) {
        const clientId = `sell${bot.entries}`;
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: clientId });
        bot.sellPending = clientId;
      }
    } else if (!bot.stoodDown && bot.entries < MAX_ENTRIES && bot.buyPending === null) {
      // Flat. Strike on a sharp one-hour drop, or on the fallback bar if
      // no dip ever came; a buy the market refused is re-sent while the
      // entry condition still holds.
      const sharpDrop =
        bot.closes.length > DROP_LOOKBACK &&
        c <= bot.closes[bot.closes.length - 1 - DROP_LOOKBACK] * (1 - DROP_BPS / 10_000);
      const fallbackDue = bot.entries === 0 && barIndex >= FALLBACK_BAR;
      if (sharpDrop || fallbackDue) {
        const clientId = `buy${bot.entries + 1}`;
        const buy = buyAll(state, clientId);
        if (buy !== null) {
          orders.push(buy);
          bot.buyPending = clientId;
          bot.entryClose = c;
          bot.cashBeforeBuy = state.cash;
        }
      }
    }

    return orders;
  },
});
