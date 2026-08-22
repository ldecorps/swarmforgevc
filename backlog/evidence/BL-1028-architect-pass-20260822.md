# BL-1028 architect pass — 2026-08-22

**Parcel:** cleaner-forwarded commit `b1081350d4` ("BL-1028: merge coder's
promotion-refusal fix, resolve conflicts"), merged into `swarmforge-architect`
(no conflicts on this branch; `bl1028PromotionRefusalSteps` registered
correctly in `specs/pipeline/steps/index.js`).

## What this fixes

`promote_and_route_next.sh` answered EVERY `commit_integrity_cli.bb` refusal
— including `:lock-timeout`/`:verify-mismatch`, which mean a concurrent
writer is active in the shared master checkout, the exact case the CLI's
lock exists to serialise — with a raw, unlocked `git add`/`git commit`
fallback, silently overriding the refusal. If that fallback also failed, the
`git mv` staged earlier was left in the shared index with nothing to unwind
it: global state any later writer's un-pathspec'd commit could sweep in.

## Correctness — traced by hand, then independently reproduced

- **The refusal is now obeyed, never overridden.** The old `|| { git add;
  git commit; }` is gone; a non-zero `commit_integrity_cli.bb` exit now
  triggers `rollback_promotion` and a non-zero script exit naming the
  reason. Traced the `else` branch (no CLI present in the target at all) —
  untouched, still a deliberate, loudly-labelled unguarded commit, exactly
  as the ticket's approval_context pins it (scenario 04).
- **The rollback is scoped, not a blanket reset — verified by manual trace
  and reproduced.** `PROMOTION_SNAPSHOT_DIR` captures `git ls-files --stage
  -- backlog/paused/$BASE backlog/active/$BASE` BEFORE the `git mv`, plus a
  copy of the paused file's working-tree content. Reproduced by hand in a
  scratch repo: for a normal tracked, unmodified file, `ls-files --stage`
  returns exactly the ONE stage-0 line for the paused path (mode, blob,
  path) and nothing for the not-yet-existing active path — confirming
  `rollback_promotion`'s `update-index --index-info` restore puts the index
  back to precisely its pre-mv state for these two paths only, never
  touching any other role's staged work in the shared checkout.
- **The snapshot-based restore is more robust than `git reset` would be for
  a shared, concurrently-written checkout**: `git reset -- path` re-reads
  against HEAD at rollback time, which could have moved between the
  snapshot and the rollback if another role committed in the interim; the
  explicit index-entry snapshot is immune to that race. The shell test's own
  scenario name confirms this was a deliberate design choice, not
  incidental: "a refusal restores the ticket's own pre-staged index entry,
  not HEAD's version" — PASS.
- **The two refusal shapes are read correctly.** `integrity_refusal_reason`
  checks for `CLOSE BLOCKED` in stderr first (the close-guard shape, which
  exits before any JSON is printed) before falling back to parsing
  `:reason` from stdout JSON or a `FAILED (reason)` stderr line — read in
  full, matches the CLI's actual two output shapes as documented in the
  ticket's own source section.
- **`INTEGRITY_RC != 0`, not `-eq 1`** — catches any non-zero exit, not just
  the documented `1`, matching invariant 1's "for any refusal reason,
  present and future" wording. The property runner's `:exotic-exit` and
  `:silent` coverage classes exist specifically to defend this.
- **The CLI's own stdout/stderr still reach the caller on a refusal** (`cat`
  of both captured streams before rolling back) — obeying a refusal does not
  make the failure quieter than the old bypass was.

## Test suites — all run directly

- `bash test/test_bl1028_promotion_obeys_integrity_refusal.sh` — **ALL
  PASS**, 8 named scenarios including the two subtle correctness cases
  traced above (scoped rollback leaving other roles' staged work untouched;
  restoring the ticket's own pre-staged entry rather than HEAD's version).
- `bb test/bl1028_promotion_refusal_property_runner.bb` — **ALL PROPERTIES
  HOLD**, 30 runs with floored coverage across five distinct refusal SHAPES
  (`:success-false` JSON+stderr, close-guard stderr-only, silent non-zero
  exit, malformed JSON, non-1 exotic exit codes) plus novel/unknown reason
  strings (18 runs) — directly defending invariant 1's "present and future"
  claim rather than only today's five documented reasons. Header documents 4
  non-vacuity breaks proven at authoring time, each mapped to the specific
  property it would violate (raw-commit fallback → P1; skip rollback → P2;
  key on exit-code 1 only → P1/P2 exit-code shapes; blanket `git reset` →
  P3).
- Acceptance `BL-1028-...feature` run live via `specs/pipeline/cli.js` —
  **10/10 pass**. `gherkin_lint_gate.sh` — parses cleanly. `bash -n` on the
  script — clean.
- Step handler (`bl1028PromotionRefusalSteps.js`) read in full: drives the
  REAL script against a REAL git fixture with a REAL Babashka stub CLI (a
  bash stub would be parsed as Clojure, die on load, and be misread by the
  old `||` as an ordinary refusal — every scenario would then pass for the
  wrong reason; the file's own header records this and the stub is
  Babashka). Asserts both `HEAD` unchanged AND `git status --porcelain`
  index-identical, not just one or the other.

## Dependency-rule gate (BL-259) and co-change (BL-255)

No `extension/` TypeScript file touched — only one JS step-handler file (test
infrastructure) plus `.sh`/`.bb` scripts. Gate run against the one JS file:
**PASSED, no forbidden edges.** Co-change over the changed files: the
SUSPECTED COUPLING flags on `promote_and_route_next.sh` are all pre-existing,
legitimate siblings — `promotion_gates_lib.bb`/`_cli.bb` (the BL-663
chokepoint this script already shells every gate decision through) and that
family's own related tickets (BL-853, BL-854, BL-663) and test files. Nothing
new or suspicious; this parcel's own diff is scoped exactly to the ticket's
named block (lines 230, 255-268 in the pre-fix script).

## Invariants (both declared)

1. **"A promotion never produces a commit that the integrity CLI refused —
   for any refusal reason, present and future."** Property-encoded (P1) with
   novel-reason generation specifically because an example table would only
   prove today's known reasons. Non-vacuity proven (raw-commit-fallback
   break → RED).
2. **"A promotion that does not commit leaves the index exactly as it found
   it."** Property-encoded (P2, plus P3 for the scoped-vs-blanket-reset
   distinction) and independently confirmed via the shell integration test's
   two most targeted scenarios (scoped-to-own-paths; pre-staged-entry not
   HEAD's version).

## What is NOT the problem — do not change

- `commit_integrity_lib.bb`/`commit_integrity_cli.bb` — verified out of
  scope by the ticket's own probing (untouched since before 2026-08-14,
  their own suites green) and untouched by this parcel's diff.
- The `else` branch (no integrity CLI in target) — deliberate degradation
  for an unguarded target, stays, correctly still says so out loud.
- `promotion_gates_cli.bb`/`_lib.bb` and the gate-evaluation flow above the
  refused block — untouched, not this ticket's concern.

## Verdict

COMPLIANT. A correctly-scoped, well-tested fix to a real safety-guard bypass
in the shared master checkout: the refusal is now genuinely obeyed for any
reason (not just today's known ones), the rollback is proven scoped to only
this script's own staged paths and race-robust against concurrent writers,
and every claim was independently traced and reproduced rather than taken on
the commit message. Forwarding to hardener.

By architect.
