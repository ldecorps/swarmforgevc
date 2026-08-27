# BL-640-constitution-reference-amendments-have-no-delivery — architect bounce

Architect ran the full gate inventory (Article 4.4 — complete pass, one
bounce). Commit reviewed: `fded1ca02` (coder's commit, forwarded unchanged
by cleaner via merge commit `e4ee01955`).

## D1 — correctness: the ticket's own headline acceptance scenario fails, every run

1. **Files**: `swarmforge/scripts/test/test_reference_freshness_guard.sh`
   (new, this parcel), exercised through `swarmforge/scripts/ready_for_next.bb`
   and `swarmforge/scripts/ready_for_next_task.sh`.
2. **What's wrong**: scenario `amendment-reaches-role-before-next-act-01` —
   the feature's headline positive-path scenario, the one BL-640 exists to
   guarantee — fails deterministically. Verified two independent ways:
   - `bash swarmforge/scripts/test/test_reference_freshness_guard.sh` on 3
     consecutive runs: `PASS: 02 (x2)` then
     `FAIL: 01: expected the claim to print, got: NO_TASK`, every time.
   - The real APS runner:
     `node specs/pipeline/cli.js specs/features/BL-640-constitution-reference-amendments-have-no-delivery.feature`
     → `# pass 4 / # fail 1`, scenario 1 ("an amended reference/ file reaches
     a role before it next acts on the amended subject") failing at
     `Then that role reads the amended text, not a stale copy` with the same
     `NO_TASK` output.
3. **Root cause**: the freshness guard itself is fine — it runs with
   `cwd = <fixture coder worktree>` and correctly reports fresh (no
   stderr). The failure is one call further down: `ready_for_next.bb`'s tail
   calls `dispatch-lib/run-dispatch!`, which `process/exec`s
   `ready_for_next_task.sh` — the **shell wrapper**, not `ready_for_next_task.bb`
   directly. That wrapper does `cd "$SCRIPT_DIR"` into the **real repo's**
   `swarmforge/scripts/` directory before invoking `bb` (its own comment:
   "Ensure we run Babashka from the scripts directory so relative paths ...
   resolve correctly regardless of the caller's CWD"). Once cwd changes,
   every downstream `git rev-parse --show-toplevel` / `target-root` /
   mailbox lookup inside `ready_for_next_task.bb` resolves against the real
   architect worktree, not the fixture — so the fixture's seeded
   `in_process` handoff is never found, and the test observes whatever the
   real repo's own coder mailbox happens to contain (currently nothing), not
   the guard's pass-through behavior.
   This is the *exact* hazard the test's own header comment (lines 16-21)
   names and correctly dodges at the outer level ("bb directly, never the
   ready_for_next.sh wrapper ... would make the guard's git-root call
   resolve against the real repo instead of this fixture") — it resurfaces
   one level deeper, inside dispatch's own exec of the task-mode `.sh`
   wrapper, and the fixture does not account for it.
   Confirmed this is not a regression the new guard code introduced: I
   extracted the pre-BL-640 `ready_for_next.bb` (parent commit `fded1ca02^`)
   into an identical fixture with no freshness guard at all — same
   `NO_TASK`, same root cause. The isolation gap in the *dispatch* path is
   pre-existing; what's new and wrong is shipping a scenario-01 assertion
   that depends on it working, in a parcel whose whole point is proving
   scenario 01.
4. **Failure class**: `behavior` (a committed, registered acceptance test
   that fails on every run — not a hand-verified invariant).
5. **Remediation pointer**: either (a) give the fixture a way to keep
   dispatch's cwd/root pinned to the fixture (an env seam analogous to
   `set-project-root!`/`SWARMFORGE_ROLE`, or driving
   `ready_for_next_task.bb` directly the same way the outer test already
   drives `ready_for_next.bb` directly, bypassing the `.sh` wrapper's `cd`),
   or (b) stop scenario 01's assertion at the guard boundary — assert the
   guard's own pass-through (clean exit, no stderr, from
   `enforce-reference-freshness-guard!` alone) rather than depending on
   `ready_for_next_task.sh` actually resolving and printing the resumed
   task. Either fix must leave
   `node specs/pipeline/cli.js specs/features/BL-640-constitution-reference-amendments-have-no-delivery.feature`
   at 5/5 green.

   Owning role: **coder** (author of `fded1ca02`, this parcel's only
   commit).

## D2 — correctness: the guard's own freshness check reads only the local `main` ref, which this repo's documented delivery path can leave behind `origin/main`

1. **File**: `swarmforge/scripts/ready_for_next.bb`, `main-reference-shas`
   (new function, this parcel).
2. **What's wrong**: `main-reference-shas` compares the worktree's
   `reference/` files against `git ls-tree -r --name-only main -- ...` —
   the **local** `main` branch only. It never reads `origin/main`. The
   currently-loaded workflow rule "A Prior QA Bounce Is Not In Your Worktree
   — Check It Against `main` (BL-340)" documents, with a dated measurement
   in *this* repo (2026-08-14: local `main` 8 ahead / 22 behind
   `origin/main`), why that single-ref assumption is wrong here specifically:
   QA lands its approved commit by pushing `HEAD:main` straight to
   `origin` (QA's own worktree can't check out and fast-forward the shared
   local `main`, since another worktree already has it checked out), while
   local `main` only advances later, whenever the master checkout next
   fetches/merges it in. In that window `origin/main` — the actually
   published tip — can carry a landed `reference/` amendment that local
   `main` does not yet have.
3. **Why this is this parcel's defect, not a hypothetical**: a worktree
   whose `reference/` file already matches the (stale) local `main` passes
   this ticket's own new guard as "fresh" during exactly that window, even
   though the true published tip already carries a newer amendment —
   reproducing, inside the guard BL-640 adds, the identical invariant
   violation the ticket exists to close ("No amendment to
   `articles/reference/` can leave any role reading a stale elaboration that
   contradicts the amended rule on `main`" — the ticket's own declared
   invariant does not say "local `main`"). This is dated and specific to
   this repo's current QA-lands-to-origin mechanics, not a generic
   what-if: `git rev-list --left-right --count main...origin/main` right
   now reports `14 0` (local ahead today), confirming the divergence this
   repo produces is real and simply pointing the other way at this exact
   moment — the BL-340 correction explicitly warns the direction flips.
4. **Test coverage gap**: neither `bl640_reference_freshness_property_runner.bb`
   nor `test_reference_freshness_guard.sh` constructs a fixture with a
   real `origin` remote at all, so an origin-ahead-of-local-main scenario
   cannot be reached by either — the gap has zero coverage, not just a
   missed case.
5. **Failure class**: `behavior`.
6. **Remediation pointer**: read both `main` and `origin/main` in
   `main-reference-shas` and treat whichever is ahead as the freshness
   baseline (same pattern the BL-340 correction already prescribes for
   bounce-history reads — e.g. `git rev-list --left-right --count
   main...origin/main`, read from the ref that is ahead), or fetch/compare
   against `origin/main` outright. Add a fixture scenario with a real
   `origin` remote where `origin/main` carries the amendment and local
   `main` does not, proving the guard still refuses.

   Owning role: **coder**.

## Everything else run — complete inventory, none blocked

- **Ticket invariant** (1 declared, BL-654): a non-vacuous property test
  exists — `bl640_reference_freshness_property_runner.bb` (P1/P2, 80+20
  generated cases, seeded `java.util.Random`, sweeps drift-count 0..n so
  no-drift/some-drift/all-drift are all demonstrably reached) plus an
  explicit non-vacuousness proof (a hand-written
  `broken-fresh?-by-count-only` mutant that the real `fresh?`/`stale-paths`
  correctly rejects). Ran it myself: `bb
  swarmforge/scripts/test/bl640_reference_freshness_property_runner.bb` →
  `bl640_reference_freshness_property_runner: ok`. This covers the pure
  `stale-paths`/`fresh?` functions; it does not (and by its own scope
  cannot) cover the IO wrapper's ref choice — that's D2 above.
- **Unit runner**: `bb
  swarmforge/scripts/test/reference_freshness_lib_test_runner.bb` →
  `ALL PASS: reference_freshness_lib.bb`.
- **Prompt-stability regression check** (scenarios 04/06): `bb
  swarmforge/scripts/test/bl640_prompt_stability_check.bb` →
  both PASS. Confirms the guard, which lives outside `compose`, does not
  regress `PromptEngine`'s no-growth / top-level-delivery behavior.
- **Acceptance**: `node specs/pipeline/cli.js
  specs/features/BL-640-constitution-reference-amendments-have-no-delivery.feature`
  → 4/5 PASS, scenario 1 FAIL — this is D1 above, not a separate item.
- **Property Testing pass** (undeclared properties on touched pure
  modules): the only pure module this parcel touches,
  `reference_freshness_lib.bb`, already has property coverage for its core
  behavior via the declared-invariant test above; no further undercovered
  property-shaped surface found.
- **Dependency-gate hard gate** (BL-259): N/A — every changed file is under
  `swarmforge/scripts/` or `specs/pipeline/steps/`, none under
  `extension/src` or `extension/media`. Confirmed by attempting the
  per-parcel invocation, which correctly errors "can't open" on a
  repo-root-relative path outside that tree.
- **Co-change report**: run against all 4 substantive changed files
  (`reference_freshness_lib.bb`, `ready_for_next.bb`,
  `bl640ConstitutionReferenceAmendmentDeliverySteps.js`, `index.js`). The
  new files' co-changes are limited to each other and the sibling test
  files (expected, single-ticket cohesion). `ready_for_next.bb` and
  `index.js` each show pre-existing hub-file "SUSPECTED COUPLING" (the
  handoff-family scripts, and the unrelated
  telegram-front-desk/concierge/operator files respectively) — expected
  noise from central files touched by many tickets' history, nothing this
  parcel's own scope should have addressed and didn't.
- **Architecture boundary rules** (two-layer, extension-host-owns-IO,
  no-webview-storage, integrate-not-fork): N/A — zero files under
  `extension/`; this parcel touches only `swarmforge/scripts/*.bb` (the
  maintained SwarmForge fork itself) and `specs/pipeline/steps/*.js` (test
  infrastructure).
- **Wiring**: `specs/pipeline/steps/index.js` correctly registers
  `bl640ConstitutionReferenceAmendmentDeliverySteps` in `DOMAINS` —
  confirmed by the acceptance run itself exercising all 5 scenarios (4
  pass, D1 fails for the reason above, not because the step handler is
  unwired).

By architect.
