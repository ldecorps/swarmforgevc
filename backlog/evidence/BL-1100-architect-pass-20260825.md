# BL-1100 — architect pass — 20260825

**Tip:** cleaner `e4998129f0` (coder chore `2874c4c501`; impl already on tip via `7aaf51f70` / QA `c9b3c5be1`)
**Handoff:** `00_20260825T185822Z_000858_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...e4998129f0` = **2 paths** (ticket YAML notes + cleaner evidence),
**0 deletes** (tip-pure reset). Product fix already ancestor of tip;
this parcel is re-verify after re-promote from pause — no further code change.

## Architecture

- Root cause: whole-YAML `is_do_not_promote` grep treated explanatory prose
  as a human park; auto-pick `continue`d silently.
- Landed shape (verified on tip): prose gate **deleted**; skips use
  structured `is_epic_type` / `is_blocked_status` + promotion_gates;
  `announce_skip` emits `skip <id> gate=<gate>` on stderr.
- Human parks survive via `status: blocked` (e.g. BL-553), not phrase match.
- No ownership / product-surface regression in this re-verify tip.

## Verification

| Check | Result |
|-------|--------|
| `bl1100PromotionProseNeverBlocks.property.test.js` | 2/2 pass |
| APS BL-1100 feature | 8/8 pass |
| `is_do_not_promote` absent under `swarmforge/scripts` | confirmed |
| Tip deletes vs `origin/main` | 0 |

By architect.
