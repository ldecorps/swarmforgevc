# BL-980 — architect pass (tip-pure rematch) — 20260827

**Tip:** tip-pure `6461b03a4` + rematch `219f0b630` → architect `f4318fe30`
(+ cleaner evidence). Cleaner tip `e672e61032` evidence-only on rematch lineage.
**Handoff:** `00_20260827T085607Z_000988_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

BL-980 paths only (board age suffix + tests + APS + docs/mutation sweep from
prior-stage tip-pure rematch after QA entangled bounce).

## Architecture

- `doneClosedAtMs` carried onto board list items as optional `closedAtMs`.
- `formatRecentlyClosedAgeLabel` pure ladder; undefined → no fabricated age
  (invariant: never mtime).
- Render only on RECENTLY CLOSED lines.

## Invariants

Property + APS encode “no age without durable closure instant” (2/2 property,
13/13 APS including durable-vs-file scenario).

## Verification

| Check | Result |
|-------|--------|
| `tsc` | pass (out refreshed for gates) |
| unit | 8/8 |
| property | 2/2 |
| APS | 13/13 |
| dep-gate | PASSED |

By architect.
