# BL-891 — hardener pass — 2026-08-14

## Scope received

Batch handoff from architect (`f912278236`, merge_and_process), routed as
its own `git_handoff` (task name `BL-891-local-main-ref-never-advances-after-qa-lands`)
separately from BL-746 and from BL-892's earlier chain, per Article 2.6.
`f912278236` was already an ancestor of this worktree's HEAD (it rode in via
the prior BL-892 hardening pass' merge); no new merge was needed.

Files in scope, per coder's commit `3853956d6`:
- `swarmforge/scripts/handoffd.bb` (cadence sweep wiring)
- `swarmforge/scripts/master_main_reconcile_lib.bb` (pure gating/state logic)
- `swarmforge/scripts/master_main_reconcile_lib_property_runner.bb`
- `swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb`
- `swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`

All Babashka/shell — outside Stryker/CRAP/DRY's scope (those tools target
`extension/src/*.ts`/`out/**/*.js` only; engineering.prompt's Startup Tools
section: Babashka has no mutation/CRAP/DRY wired, gated only by its own
unit-test suite). No hand-authored surgical mutation sweep was needed either
— that fallback is for the BL-638 zero-Scenario-Outline Gherkin case, not a
general substitute for Babashka tooling.

The ticket's own acceptance is `specs/features/BL-891-local-main-ref-reflects-landed-commit.feature.draft`
— still a `.feature.draft` with no step handlers (per the "unbuilt feature
files park as draft" convention), all plain `Scenario:` blocks (no
`Scenario Outline:`), so BL-113 Gherkin mutation does not apply. The coder's
own commit message states the property test + E2E wiring test cover the
ticket's 2 declared invariants and its QA end-to-end procedure (a)-(d)
directly against real git, which is what I verified below.

## Pre-flight

- No orphaned test/mutation processes from a prior run
  (`pgrep -fl 'node --test|stryker'` clean before starting).
- `uptime` at pass start: load avg 6.31/6.10/6.63 on 4 cores (~1.6x) —
  elevated but under the 2x-cores threshold; proceeded with the suite as-is
  (no Stryker involved for this ticket's files regardless).

## Test verification

- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb`:
  **ALL TESTS PASS**.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`:
  **500 runs, ALL PROPERTIES HOLD**; both non-vacuity assertions confirmed
  (invariant 1's oracle would flag a mutant that merges a dirty tree;
  invariant 2's oracle would flag a mutant that blocks a dirty tree without
  surfacing why) — not a vacuously-true property test.
- `bash swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`:
  **ALL SCENARIOS PASS** (9/9), directly exercising the ticket's own QA
  end-to-end procedure: pure fast-forward, idempotent re-sweep, genuine
  two-way divergence reconciled via a real merge commit (never a history
  rewrite), dirty-tree block + surfaced reason, no reset/stash/force-update
  while dirty, and self-heal once the tree is clean again.

No survivors, no gaps found. Every invariant in the ticket's `invariants:`
block is exercised by a real assertion, not merely by a call being made.

## Post-run cleanup check

`pgrep -fl 'node --test|stryker'` and `pgrep -afl tmux` both clean after the
runs — only the live swarm's own `swarmforge-coder` and `operator` tmux
sessions present, no leaked fixtures, no orphaned test processes.

## Verdict

Hardened: existing coverage of BL-891's two invariants and its full QA
procedure is real and non-vacuous; no gaps found, nothing to add. Forwarding
to documenter as its own `git_handoff`, per Article 2.6 (this ticket's own
task name, not folded into BL-892's forward).

By hardener.
