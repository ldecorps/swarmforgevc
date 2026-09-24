# BL-1712: spec-gap note to the specifier - register row removal timing

## What's done this pass

- `extension/src/metrics/pricingTable.ts`: `'claude-opus-5-5'` row added -
  `inputPerMTok: 4`, `outputPerMTok: 20`, `cacheReadPerMTok: 0.2`, no
  `cacheCreatePerMTok` (comment names the source and both read dates,
  2026-06-24 cached / 2026-09-24 re-read at implementation - the claude-api
  skill's cached table still shows $4/$20/cache-reads $0.20 for
  `claude-opus-5-5` as of this pass, so the published rates the ticket
  proposed at mint are unchanged).
- `extension/src/swarm/modelDisplayName.ts`: `'claude-opus-5-5': 'Opus 5.5'`.
- `extension/test/pricingTable.test.js`: three new unit tests mirroring
  BL-1436's own precedent for the honest-null cache-creation branch, plus a
  direct rate-value test; the pre-existing "ONE row" comment on the
  fable-5-1 null-cache-creation test corrected to "one of the rows" since a
  second (`claude-opus-5-5`) now shares that shape.
- `PRICING_TABLE_VERSION` left at 3 (unchanged - a rate addition, not a
  correction, per BL-1436's own precedent).
- `npx vitest run test/pricingTable.test.js test/modelDisplayName.test.js`:
  40/40 green, including "BL-627: the current repo roster passes the
  pricing coverage check" (was red before this pass - `db5d1313e4` moved
  the full-forge specifier seat to `claude-opus-5-5` with no pricing row).

`specs/pipeline/steps/bl1712PricingTableOpus55Steps.js` written, matching
the feature's current wording; `run_acceptance.sh` on the parcel's own
tree: **5 of 6** (scenario 04 fails - see below). No `standing-reds.tsv`
edit made.

## The conflict (same class as BL-1638, 2026-09-21)

BL-1712's own acceptance feature
(`specs/features/BL-1712-the-pricing-table-prices-claude-opus-5-5.feature`,
scenario 04, tag `BL-1712 the-pricing-table-prices-claude-opus-5-5-04`)
asserts "no register row names pricingTable.test.js or the BL-1436 feature
file" - i.e. the two `standing-reds.tsv` rows named at this ticket's mint
are gone, in THIS parcel's own commit. The ticket's own body text (written
2026-09-24) says the same: "both register rows leave in the same land."

The coder role prompt's current, governing rule (2026-09-20, BL-1663) says
the opposite: "A parcel never edits backlog/standing-reds.tsv ... the land
step retires it (BL-1631) ... Register rows are the specifier's to add and
the land's to remove." This is the identical spec gap the specifier already
ruled on for BL-1638
(`backlog/evidence/BL-1638-spec-gap-register-row-removal-20260921.md`,
`backlog/evidence/BL-1638-spec-gap-register-row-removal-adjudication-specifier-20260921.md`):
BL-1638 was minted 2026-09-18, before BL-1663; BL-1712 was minted
2026-09-24, after BL-1663 was already the governing coder-prompt rule - so
this mint carries forward mint-time wording the specifier's own prior
ruling already superseded.

I have not edited `standing-reds.tsv` in this parcel, per the newer rule.
Scenario 04, run literally against my current commit, fails on "no
register row names pricingTable.test.js or the BL-1436 feature file" (both
rows present, correctly owned by BL-1712, not yet removed - removal is
QA's land, per BL-1631/BL-1663). Full failing-scenario output captured in
this pass's terminal log; the rows read exactly as the mint commit
(eff9ef984e) left them.

## Ask

Requesting the same ruling BL-1638 already received, applied here:
scenario 04 amended to assert `pricingTable.test.js` and the BL-1436
feature's rows are PRESENT, and each names an OPEN ticket (BL-1712) - i.e.
"owned, not unowned" - at the parcel commit, rather than absent; row
absence stays a post-land check only (`qa_e2e_procedure` step 5's
`standing_red_register_cli.bb` run, unchanged). Tag rename to
`...-register-row-owned-04` if the specifier wants parity with BL-1638's
`-owned-01/03` renaming (this is an unbuilt scenario of an in-flight
ticket, not a landed contract).

No production work is blocked by this - only
`specs/pipeline/steps/bl1712PricingTableOpus55Steps.js`'s scenario-04 step
definitions and the parcel's forward to cleaner. `pricingTable.ts`,
`modelDisplayName.ts`, and the new unit tests are committed and hold
regardless of this ruling.

By coder.
