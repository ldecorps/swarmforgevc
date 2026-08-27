# INTAKE — Same-model Cursor coders: coordinator may route to either seat

**Source:** human via Cursor, 2026-08-26 ~23:16 BST  
**Priority:** 00  
**Pack context:** `cursor-forge` — both coder seats declare `--model auto`

## Ruling

When **both coder seats run the same model** (here: `auto` on `coder` and
`coder@cursor2`), the coordinator may pass coder work to **either seat**
regardless of the ticket's `mutation_cost` or declared `--seat-tier`.

Difficulty-aware routing (BL-1001 / `--seat-tier hard` vs `easy`) applies
when seats are **model-differentiated** (e.g. Fable vs Sonnet on
`full-forge`). It does **not** bind the coordinator when the seats are
model-equivalent.

## Why

- `coder` and `coder@cursor2` are both `--model auto` today — no capability
  gap to protect by tier.
- Holding easy-only work off `coder@cursor2` when both seats are the same
  model is false economy: it starves the second seat without reducing bounce
  risk.
- Coordinator promotion + route should load-balance across idle coder panes,
  not treat `mutation_cost` as a hard seat filter in this configuration.

## Do / don't

| Do | Don't |
|----|-------|
| Route coder tickets to whichever coder seat is idle or less loaded | Refuse to route medium/high `mutation_cost` to `coder@cursor2` solely because its window line says `--seat-tier easy` |
| Use `mutation_cost` for estimation, briefing, and future model splits | Treat BL-1001 tier rules as binding coordinator routing while both seats share `auto` |

## If models diverge again

Re-enable tier discipline: assign distinct `--model` (or distinct effective
capability) per seat and restore hard→`coder`, easy→`coder@cursor2` routing
per BL-1001.

## Related

- `swarmforge/packs/cursor-forge.conf` — both coder windows on `auto`
- BL-1001 (paused) — difficulty-aware claim routing when tiers matter
- BL-983 — multi-seat stage addressing (`coder@cursor2`)
- Live copy: `.swarmforge/operator/INTAKE-cursor2-same-model-no-tier-routing.md`
