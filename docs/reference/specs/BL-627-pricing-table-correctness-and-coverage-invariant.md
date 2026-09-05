# BL-627 — Pricing table correctness and coverage invariant

## What landed

- Corrected Anthropic list-price rates in `extension/src/metrics/pricingTable.ts` and bumped `PRICING_TABLE_VERSION` to **2**.
- Added `claude-opus-5` ($5 / $25 per MTok).
- Exported `collectReferencedClaudeModels` + `checkPricingCoverage` / `assertPricingCoverage`: every bare `claude-*` id in `swarmforge.conf`, `swarmforge/packs/*.conf`, and `.swarmforge/launch/*.claude-settings.json` must have a `PRICING_TABLE` entry or the check fails naming the model.
- **BL-740:** `addClaudeModelsFromDir` helper + fixture tests drive every packs/launch scan branch; `collectReferencedClaudeModels` meets CRAP≤6. Tests: `extension/test/pricingTable.test.js` (`BL-740:` cases).

## Specifier rulings (recorded)

| Topic | Ruling |
|---|---|
| Sonnet 5 intro pricing ($2/$10 through 2026-08-31) | **Ignore** — keep list $3/$15; document the overstatement during the intro window. Time-bounded rates are out of scope for this table. **Reversed by [BL-1056](../../how-to/BL-1056-a-price-with-an-expiry-date.md):** rows now carry optional `until`/`then` validity metadata, resolved per-instant; `claude-sonnet-5` costs at $2/$10 through 2026-08-31 and $3/$15 from 2026-09-01. Every windowless row keeps this table's one-line shape unchanged. |
| Coverage scope | Anthropic-native bare `claude-*` ids only. Provider-prefixed pack models (OpenRouter/Mistral/…) are outside this list-price table. |
| Auto-updater / cron | **Rejected** — no scraper; rates stay human/agent-verified. Roster drift is what the coverage check catches. |

## Acceptance

`specs/features/BL-627-pricing-table-correctness-and-coverage-invariant.feature`

See also [BL-1056](../../how-to/BL-1056-a-price-with-an-expiry-date.md) for the price-validity-window follow-on that revisits the intro-pricing ruling above.

## A missing row is a red on `main`, not a silent zero (BL-1436)

The coverage check this ticket built worked exactly as designed on
2026-09-04: `swarmforge/packs/full-forge.conf` moved the specifier seat
from the imprecise `claude-fable-5` to the exact `claude-fable-5-1`, and
`pricingTable.test.js` went red the same day, naming the gap
(`collectReferencedClaudeModels` reads the packs; `PRICING_TABLE` had no
`claude-fable-5-1` row). Every turn of that seat was costed at `null` —
invisible to the BL-551 ledger and the briefing — until the row landed
2026-09-05. `claude-fable-5-1` is now priced (input $10, output $50 per
million tokens, cache read $0.25 — a Fable-5.1-specific cache-read rate,
not the 0.1x-of-input convention the other rows use; verified against the
project's Claude API reference, cached 2026-06-24, rather than copied from
the sibling `claude-fable-5` row, which is exactly how BL-627's own
original defect happened). No cache-creation rate is published for this
model; the row deliberately leaves `cacheCreatePerMTok` unset rather than
guessing or deriving one from `claude-fable-5` — `estimateCostUsd` returns
`null`, never a guessed or zero rate, for a turn that actually spends
cache-creation tokens on this model, which is this table's existing
invariant (an unpriced category is reported as unknown, never miscosted)
applied to a per-model gap rather than a whole-row one. `modelDisplayName.ts`
now maps the id to `Fable 5.1`. Acceptance:
`specs/features/BL-1436-the-pricing-table-prices-every-model-the-swarm-runs.feature`.
