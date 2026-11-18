# Strategy note — Dip-Catch + Stand-Down

## What the dev window looks like

The dev window is 1,440 one-minute bars of cbBTC in which BTC falls from
$65,083 to $63,261 (-2.80%): a sharp 2.5% drop in the first two hours, a
1.9% rebound to $65,190 around midnight, then a slow grind down to the
close. One-minute returns have a ~6.7 bps standard deviation and 146 of
the bars are flat. A full-size round trip costs ~26 bps (4 bps fee + 2 bps
slippage + ~7 bps of constant-product impact each way at $1,000 against
~$1M of pool depth), so a trade has to catch a move bigger than that just
to break even.

## What was tested and rejected

All candidates were evaluated with a local replay simulator that mirrors
the harness fill model exactly (integer math, fills at the next bar's open,
fee / slippage / impact, max-slippage rejections, end-of-window flatten).
It reproduces this entry's official grade-local score to the cent, so
candidate scores are directly comparable to grading. 1,107 combinations
were gridded across four families on this window, plus robustness checks
on the time-reversed window, two block-shuffled copies, and the two
previous rounds' dev windows.

- **Previous round's winner (anchor-dip + wide 2.5% trail): -$27.68.**
  It buys the first pullback and rides the whole decline; the trailing
  stop fires near the bottom. The design that won a +0.49% window fails
  a -2.80% window outright.
- **Plain EMA crossover / Donchian / momentum / Bollinger / RSI
  families:** re-tested from the previous round's grid — all still
  negative on this window, -$6 to -$200. Frequency is the enemy: every
  design that trades more than a couple of times loses money to its own
  costs.
- **Dip-buy without a take-profit (trail only):** the 1.9% rebound is
  given back while the trail waits; +$2-4 at best.
- **Dip-buy with a tight trail (0.8%):** cuts the grind-day loss to
  -$7.92 but also clips the winners; +$12.51 with a 1.60% take-profit,
  and only +$0.53 on the uptrend (reversed) window.
- **Bounce-confirmation entries** (buy only after the price lifts off its
  30-bar low): +$13.06 on dev, but $0 on the uptrend window — the
  confirmation never fires when there is no dip to confirm.

## The final design

**Entry — a sharp one-hour drop.** Buy the whole cash balance when the
close is at least 1.60% below the close 60 bars ago. A 1.6% hourly drop
is ~5 standard deviations of the 60-bar return, so it fires rarely
(twice on the dev window) and only after real selling. The buy fills at
the next bar's open, so the bot catches the drop's aftermath, not the
knife's edge.

**Exit — a quick take-profit and a trailing stop.** Sell everything at
+1.20% above the entry close (the window's real bounces run 1.6-1.9%
from their lows, so 1.20% takes most of one), or at 1.50% below the
highest close since entry if the bounce never comes. Once the position
is 0.60% in profit the trail tightens to 0.80%, so a working bounce
keeps more of its gain on a sharp reversal. The lock is verified neutral
on every window tested — it only bites on a reversal the tests never
show, which is exactly the race-day case it insures against.

**Stand down after a loss.** If a round trip ends with less cash than
the bot held before the buy — judged exactly from the fills and the cash
balance — the bot stops trading for the rest of the window. One failed
dip-buy is evidence the day is a falling-knife grind rather than a
reverting dip. This bounds the previous round's -4% grind day to -$14.14
instead of -$32.24, and it costs nothing on the dev window, where both
strikes win.

**Fallback anchor.** If no dip ever comes by bar 720 (half the window),
buy once anyway with the same exits. This guarantees the race guardrail
(>= 1 trade) on a trend day with no sharp drops: on the dev window
time-reversed (an uptrend day) the fallback rides the second half up
for +$9.57.

**Sizing.** Full cash per entry, one position, 1% max slippage per order.
At most two entries per window.

## Results

| Window | Net PnL | Trades | Max drawdown |
| --- | --- | --- | --- |
| Dev (official grade-local) | +$16.37 | 4 | 1.12% |
| Dev time-reversed (uptrend day) | +$9.57 | 2 | — |
| Previous dev window 20261117 (+0.49% day) | +$8.90 | 2 | — |
| Previous dev window 20261115 (-4% grind day) | -$14.14 | 4 | — |
| Dev block-shuffled, 2 seeds | -$12.81 / -$17.56 | — | — |

The dev profit comes from two disciplined strikes: a quick scalp of the
early drop's first bounce (+$7.6) and a longer hold through the midnight
rebound to the take-profit (+$8.8). The design is honest about its risk:
on a pure-noise day it pays the cost of striking at random drops, bounded
by the stand-down rule; on a grind-down day it loses about 1.4%; on a
trend day in either direction it makes money — falling days through the
dip strikes, rising days through the fallback anchor. Drawdown stays far
inside the 25% race guardrail on every window tested.
