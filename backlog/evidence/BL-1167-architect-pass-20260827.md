# BL-1167 — architect pass — 20260827

**Tip:** tip-pure `0df196c12` + `0452531b2` + cleaner `264768926` → architect
(with BL-1185 Work-note attribution kept alongside same-model bypass).
**Handoff:** `00_20260827T093458Z_000997_from_cleaner_to_architect`
Ancestry tip `20bf1ee84f` recorded via `-s ours`.

## Verdict

**Pass** — forward to hardender. Inventory NONE.

## Architecture

When every window seat of a stage declares the same effective `--model`,
`difficulty-claim-decision` bypasses BL-1001 tier ceilings and follows
BL-983 idle-first claim order. Different models keep tier filtering.

## Conflict / tip purity

- Kept sibling `bl1185` APS registration.
- Tip-pure cleaner drop of BL-1185 hitchhiker reversed on architect tip so
  Work-note `mutation_cost` attribution remains (already QA-landed sibling).

## Verification

| Check | Result |
|-------|--------|
| `seat_difficulty_lib` runner | ALL PASS |
| APS | 3/3 |

By architect.
