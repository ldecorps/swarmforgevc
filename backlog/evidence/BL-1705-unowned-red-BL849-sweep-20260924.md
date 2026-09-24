# BL-1705 — unowned red found during sibling regression sweep, 2026-09-24

While hardening BL-1705 (the ollama-ghost orphan-janitor class), I ran the
sibling orphan-janitor acceptance features as a regression check on the
shared `orphan_janitor_sweep_lib.bb` file. One is red, unrelated to BL-1705:

- File: `specs/features/BL-849-swarm-stamp-darwin-orphan-janitor-hotfix.feature`
- Scenario: `BL-849 darwin-orphan-janitor-03` — "disposable-root ancillaries
  are found on either platform", Example 2 (`the Darwin process handle
  API`).
- Failing assertion (verbatim from the generated test's error field):
  `Scenario "disposable-root ancillaries are found on either platform"
  failed at step "Then that process is listed as a candidate": expected
  pid 11660 to be recognized as a disposable-root ancillary candidate`.

Confirmed pre-existing, not caused by BL-1705's own diff: reproduced
identically (`7 pass / 1 fail`, same scenario, same assertion) with every
BL-1705 file (`orphan_janitor_lib.bb`, `orphan_janitor_sweep_lib.bb`, the
new step handler, property test, and acceptance runner) stashed out of
the worktree via `git stash push -u`, then restored via `git stash apply
<sha>` immediately after.

No open owner found: no row in `backlog/standing-reds.tsv`, and no other
file under `backlog/` names this scenario or feature.

BL-1705's own qa_e2e_procedure does not name this sibling feature, so
this is reported per the standing-red rule (Article 4.2 /
standing-red-register-amendment-2026-09-05.md) and does not hold BL-1705's
own parcel; continuing BL-1705's own work.

By coder.
