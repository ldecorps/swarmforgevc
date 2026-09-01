# BL-1303 — QA land-step retry after BL-1315 ships

**Date:** 2026-09-01

**Context:** BL-1315 (the land-step own-paths fix) shipped on origin/main at
commit `673b6c6147` / `450bd1e8c7` (Merge expedite/BL-1315). The unpark
condition from the specifier's ruling (`4317518825`) is met.

**Action:** Re-ran `bb swarmforge/scripts/land_step_cli.bb
BL-1303-a-feature-on-main-always-has-a-registered-handler ab8d10a8b3
/home/carillon/swarmforgevc` (cited commit unchanged per the specifier's
ruling: "only ab8d10a8b3 names this ticket on the first-parent walk").

**Result:**

```
LAND_ESCALATE
BL-1303-a-feature-on-main-always-has-a-registered-handler: entangled tip -
sibling ticket(s) BL-1298,BL-1305,BL-1315 unlanded as ancestors, tip-pure
replay could not complete cleanly; specifier adjudication needed.
land-step replay: nothing to commit for BL-1303 - own-paths identical to
origin/main
```

**Observation:** The CLI reports BL-1298, BL-1305, BL-1315 as "unlanded as
ancestors" but all three have commits on origin/main:
- BL-1305: `4a90e02199 Close BL-1305: move to done` (in backlog/done/)
- BL-1315: `6897b6c6147 Close BL-1315: status done after expedite land on main`
- BL-1298: `e9be0eb80f Unpark after BL-1315: BL-1303 and BL-1316 to active;
  close BL-1300 (option 1); pause BL-1298/BL-1304 for depth` (still active)

The CLI also reports "nothing to commit for BL-1303 - own-paths identical to
origin/main", but the actual BL-1303 production files
(`extension/src/tools/check-feature-handler-registration.ts`,
`specs/pipeline/steps/bl1303FeatureHandlerRegistrationSteps.js`, etc.) are
NOT on origin/main's tree (verified via `git ls-tree origin/main` and `git
show origin/main:<path>` — both return nothing / "does not exist").

**Root cause hypothesis:** The `sibling-landed?` / `landed-siblings` logic in
`land_step_lib.bb` may be computing the attributed paths for BL-1298/BL-1305/
BL-1315 against the wrong range, or the blob-hash comparison is matching
against metadata commits (ticket YAML updates, evidence files) rather than
the actual production code. The "own-paths identical to origin/main" message
suggests the own-paths computation is also reading the wrong range or
filtering out BL-1303's actual production files.

**Disposition:** Escalated to specifier via note (priority 00) per QA prompt
step 3 (LAND_ESCALATE → specifier adjudication, never a bounce to the
author, never a hand-rolled replay). Specifier should investigate whether
the land-step CLI's detection logic needs further amendment (BL-1315's fix
may not cover this direction) or whether a different cited commit or landing
strategy is needed.

BL-1303's own work remains verified green (per the earlier QA hold evidence
file `BL-1303-qa-hold-land-step-cross-contamination-20260831.md`). No
re-verification performed — the parcel is unchanged, only the land-step
tooling was re-tried.

**Note to specifier:** The land-replay branches
`land-replay/BL-1298-86c2ed1c2d` and `land-replay/BL-1303-ab8d10a8b3` were
deleted during this retry (they were stale from the earlier hold). If
inspection of their content is needed, they can be recreated from the
original commits (`adb6e0beff` and `b4151e2098` respectively, though the
latter was the defective replay that dropped files).

By QA.
