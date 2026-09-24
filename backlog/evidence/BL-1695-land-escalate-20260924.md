# BL-1695 land-escalate, 2026-09-24

`bb swarmforge/scripts/land_step_cli.bb BL-1695 d71276404f <root>` refused
to replay:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1671
ENTANGLED_SIBLING BL-1687
ENTANGLED_SIBLING BL-1692
ENTANGLED_SIBLING BL-1693
BL-1695: entangled tip - sibling ticket(s) BL-1671,BL-1687,BL-1692,BL-1693
unlanded as ancestors, tip-pure replay could not complete cleanly;
specifier adjudication needed.
land-step: refusing to replay BL-1695 - backlog/active/BL-1692-the-
freshness-cli-test-waits-for-the-front-desk-status-not-its-pid-file.yaml's
only owner(s) BL-1692 are closed on origin/main (backlog/done/) and no
commit of BL-1695's own touches
backlog/active/BL-1692-the-freshness-cli-test-waits-for-the-front-desk-
status-not-its-pid-file.yaml - never decided silently (BL-1546)
```

Disposition on `origin/main` (checked via `git ls-tree -r origin/main --
backlog/active/ backlog/done/`):

- BL-1671: `backlog/done/` — already landed.
- BL-1692: `backlog/done/` — already landed.
- BL-1687: `backlog/active/` — still unlanded.
- BL-1693: `backlog/active/` — still unlanded.

My worktree (`swarmforge-QA`) still carries all four ticket YAMLs under
`backlog/active/` — the close-bookkeeping commits for BL-1671 and BL-1692
were never merged onto this branch. The walk cannot distinguish "landed but
stale file still present in my tree" from a genuinely unlanded sibling for
BL-1692 specifically, and refuses per BL-1546 rather than decide silently.

No existing adjudication file covers this exact class (landed-sibling's
backlog YAML stale-but-present on QA's own long-lived branch confusing the
own-paths walk). Sending to specifier for a ruling: land BL-1671/BL-1692
ordering, and whether BL-1687/BL-1693 (both genuinely still active/unlanded)
block BL-1695's land or can be excluded.

By QA.

## Second instance — BL-1693, same class (2026-09-24)

`bb swarmforge/scripts/land_step_cli.bb BL-1693 ef856984e8 <root>` refused
with the identical root cause (BL-1692's stale `backlog/active/` yaml still
present on this branch, closed on `origin/main`):

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1671
ENTANGLED_SIBLING BL-1687
ENTANGLED_SIBLING BL-1692
ENTANGLED_SIBLING BL-1695
BL-1693: entangled tip - sibling ticket(s) BL-1671,BL-1687,BL-1692,BL-1695
unlanded as ancestors, tip-pure replay could not complete cleanly;
specifier adjudication needed.
land-step: refusing to replay BL-1693 - backlog/active/BL-1692-...yaml's
only owner(s) BL-1692 are closed on origin/main (backlog/done/) and no
commit of BL-1693's own touches that file - never decided silently
(BL-1546)
```

Same structural class already reported above (this file) — no second note
sent per the one-escalation-per-class rule. BL-1693's own review pass is
independently PASS (`backlog/evidence/BL-1693-QA-20260924.md`); it is
parked pending the same specifier ruling as BL-1695.
