# BL-627 — Pricing table correctness and coverage invariant

## What landed

- Corrected Anthropic list-price rates in `extension/src/metrics/pricingTable.ts` and bumped `PRICING_TABLE_VERSION` to **2**.
- Added `claude-opus-5` ($5 / $25 per MTok).
- Exported `collectReferencedClaudeModels` + `checkPricingCoverage` / `assertPricingCoverage`: every bare `claude-*` id in `swarmforge.conf`, `swarmforge/packs/*.conf`, and `.swarmforge/launch/*.claude-settings.json` must have a `PRICING_TABLE` entry or the check fails naming the model.

## Specifier rulings (recorded)

| Topic | Ruling |
|---|---|
| Sonnet 5 intro pricing ($2/$10 through 2026-08-31) | **Ignore** — keep list $3/$15; document the overstatement during the intro window. Time-bounded rates are out of scope for this table. |
| Coverage scope | Anthropic-native bare `claude-*` ids only. Provider-prefixed pack models (OpenRouter/Mistral/…) are outside this list-price table. |
| Auto-updater / cron | **Rejected** — no scraper; rates stay human/agent-verified. Roster drift is what the coverage check catches. |

## Acceptance

`specs/features/BL-627-pricing-table-correctness-and-coverage-invariant.feature`
