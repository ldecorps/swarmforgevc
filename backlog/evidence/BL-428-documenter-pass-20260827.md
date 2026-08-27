# BL-428 — documenter pass — 20260827

Hardener forward: `28a973dfac` (`merge_and_process hardender 28a973dfac`;
merge ancestry on `ee59147b2`).

## What changed

First module-scoped decrap slice from the standing tracker: `paneHistory.ts`
(`detectFooterLineCount` and helpers) brought to CRAP≤6 with behavior-
preserving refactor, unit coverage, and surgical mutation sweep. Pure
internal refactor — no user-visible commands, settings, or flows.

## Doc surfaces checked

- Grepped `docs/` for `paneHistory`, `detectFooterLineCount`, `BL-428`:
  only hits are BL-1014's boundary note (BL-428 remains the standing on-touch
  CRAP tracker — still accurate) and BL-792 test-duration table (path name
  only). No living doc describes retired behaviour or stale mirror routing.
- README / `docs/index.md` / diagrams — no paneHistory or CRAP-on-touch
  user-facing surface to update for this slice.
- Ticket carries no acceptance feature; no new how-to warranted (classify,
  never fill).

## Forward

Materialize hardener delta (evidence, regression test, sweep script). **Spec-gap
(SG1):** ticket `acceptance:` is block-scalar prose — pre-QA BL-761 fails closed
as unreadable; cannot `git_handoff` to QA until specifier amends acceptance to
a resolvable feature path (or documents a standing-tracker bypass). Note to
specifier + coordinator priority `00`.

By documenter.
