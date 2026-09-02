# Querying the price cliff — validity windows in the pricing table (BL-1056)

`extension/src/metrics/pricingTable.ts` corrects prices for the instant
being costed, and answers whether any rate is about to change, instead of
depending on a human remembering a date.

## Why this exists

BL-627 deliberately kept time-bounded rates out of the pricing table: a
model had exactly one set of rates, forever. That meant `claude-sonnet-5`
was costed at its published list price ($3/$15 per MTok) even during its
introductory window ($2/$10 through 2026-08-31) — overstating every Sonnet
seat by 50% until the window closed, and then becoming correct with no
signal at all when it did.

BL-1056 reverses that one omission, without giving up the one-line-per-model
shape for every model that has no window.

## Give a row a validity window

A `PRICING_TABLE` entry gains two optional fields:

```ts
'claude-sonnet-5': {
  inputPerMTok: 2,
  outputPerMTok: 10,
  cacheCreatePerMTok: 2.5,
  cacheReadPerMTok: 0.2,
  until: '2026-08-31',                 // last day these rates apply (UTC)
  then: { inputPerMTok: 3, outputPerMTok: 15, cacheCreatePerMTok: 3.75, cacheReadPerMTok: 0.3 },
},
```

- `until` is the last UTC calendar day the row's own rates apply.
- `then` is the `Rates` that take over starting the day after `until` — or
  explicit `null` when the model has no rate at all after the window. A
  `null` costs like an unpriced model: `estimateCostUsdAt` returns `null`,
  never a fallback rate and never zero.
- A model with neither field is unchanged: one rate, applied at every
  instant, exactly as before this ticket.

## Cost at a specific instant

`estimateCostUsd`/`estimateCostUsdAt` already resolve the rate for the
instant being costed:

```ts
import { estimateCostUsdAt } from '../metrics/pricingTable';

estimateCostUsdAt(usage, 'claude-sonnet-5', new Date('2026-08-15T00:00:00Z')); // intro rate
estimateCostUsdAt(usage, 'claude-sonnet-5', new Date('2026-09-01T00:00:00Z')); // list rate
```

Callers that cost a stored usage record must pass that record's own
timestamp, not "now" — costing an old record at today's clock silently
answers with whichever rate is in force today, not the rate that actually
applied when the usage happened.

## Ask what's about to change

Run the CLI with no argument to ask "as of now", or a `YYYY-MM-DD` day to
ask as of that day:

```
node extension/out/tools/pricing-windows.js
node extension/out/tools/pricing-windows.js 2026-08-20
```

It prints JSON: the instant it answered for, and one entry per windowed
model whose boundary has already closed (`status: "closed"`) or falls
within `PRICING_WINDOW_ALERT_DAYS` (30) days (`status: "closing"`), each
with `daysRemaining` (negative once the boundary has passed). Windowless
models are never listed — they have nothing to go stale.

A malformed or calendar-invalid day (`2026-02-30`, which `Date` would
otherwise silently roll to March 2nd) is refused with usage on stderr and a
non-zero exit, not answered for the wrong day.

## What this does not do

No autonomous seat mutation of any kind. This only makes the table honest
about time and queryable about its own cliffs — it changes no running
seat's model and proposes no tier-down. Any seat swap justified by a rate
change is still a human or steward decision, made separately.

See [SwarmForge VS Code Extension — Specification](../reference/Specification.MD)
and [BL-627 — Pricing table correctness and coverage invariant](../reference/specs/BL-627-pricing-table-correctness-and-coverage-invariant.md).
