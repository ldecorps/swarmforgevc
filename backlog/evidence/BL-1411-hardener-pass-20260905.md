# BL-1411 — hardener pass, 2026-09-05

Ticket: BL-1411-a-forward-built-on-an-amended-contract-is-refused
Commit reviewed: a25efb737b (cleaner) / e523e20904 (architect, NONE pass)

## Result: NONE — no defect found; BL-113 mutation clean (2/2 killed)

This ticket changes `swarm_handoff.bb`'s live validation chain, the tool
this very hardening pass (and every role's forwards this session) sends
through — reviewed with extra care given the blast radius.

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/contract_freshness_gate_lib_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/bl1411_...property_runner.bb` | ALL PROPERTIES HOLD, 300/300 each of P1/P2/P3a/P3b, coverage `{:p3a-differs-unknown 44, :p1-amend-main 156, :p2-no-field 150, :p3a-no-base 56, :p3a-clean 54, :p1-edit-parcel 168, :p3a-path-absent 53, :p2-is-block 156, :p3a-not-ref-exists 51, :p3a-refuse 42, :p1-amend-main-false 144, :p2-has-field 150}` |
| `node specs/pipeline/cli.js specs/features/BL-1411-...feature` | 5/5 scenario runs |
| `bash test_swarm_handoff_sync_deliver.sh` (regression) | ALL PASS |
| `bash test_swarm_handoff_daemon_backup.sh` (regression) | ALL PASS |
| `bash test_swarm_handoff_inbound_non_forwarding.sh` (regression) | ALL PASS |
| `bash test_swarm_handoff_inbound_non_forwarding_batch.sh` (regression) | ALL PASS |
| `bb task_scope_gate_lib_test_runner.bb` (sibling gate regression) | ALL PASS |
| `grep -n contract-freshness-gate-lib/refusal-message swarm_handoff.bb` | inside the validation chain (required_wiring) |
| `bl1411ContractFreshnessGateSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation (one Scenario Outline, 2 examples)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1411-a-forward-built-on-an-amended-contract-is-refused.feature
<fresh mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4
positionals explicit, workdir removed after). Result: **2 mutants, 2
killed, 0 survived** (the `<state>` example cells, single-letter case
flips) — clean. Manifest stamp committed alongside this evidence.

## Manual trace of `contract_freshness_gate_lib.bb`'s edge cases

Given the live-path stakes, traced several boundary cases beyond what the
prior three roles' evidence explicitly walks through:

- **`path-differs?`'s `case` on `git diff --quiet`'s exit code** correctly
  treats any exit other than 0/1 (a comparison failure, not merely "differs")
  as `nil`, which `decide-for-ref` maps to `:not-evaluated` — never
  misread as either "clean" or "refuse." Confirmed by reading the `case`
  form: the implicit default branch returns `nil`.
  - **What "some other exit" actually looks like in real `git diff`, verified
    live (not merely reasoned):** deliberately ran `git diff --quiet
    <bad-sha> <ref> -- <path>` against a real fixture repo. Result: `git`
    itself refuses at exit 128 with `fatal: bad revision '<bad-sha>'` —
    stderr, not a 2/3/4 "ambiguous" class this ticket's own doc comment
    seems to have in mind. `(int 128)` still falls through the `case`'s
    `0`/`1` branches to the implicit `nil` default exactly as intended, so
    the fail-open behavior holds regardless of which non-0/1 code git
    actually returns for this call shape — the code is correct on the
    exit-code contract even though the specific "why would exit be >1"
    example a reader might picture (an ambiguous ref) isn't the one that
    actually reaches this path in practice (a bad `base`/`ref` here would
    already have been caught earlier by `ref-exists?`/`merge-base`
    returning nil, so `path-differs?` is only ever called with two
    real, resolved refs — 128 was reachable only by injecting a
    deliberately-bad sha directly into the fixture, bypassing the earlier
    guards).
- **A ticket that moved to `backlog/done/` between an earlier role's pass
  and the sender's own send** (exactly what happened to BL-1370 live during
  this ticket's own coder pass, per that role's qa_e2e note #2) makes
  `active-ticket-yaml-content` return nil, and the gate fails open with a
  `:warning`, never a refusal — matching `task-scope-gate-lib`'s own
  identical, pre-existing active-only scope. Not a new gap this ticket
  introduces; the same convention every sibling send-time gate already has.
- **`type: note` sends are completely unaffected** — the gate's own guard
  clause is `(= "git_handoff" type)`; every merge-up/chase/amendment note
  this session sent or received skips it entirely. Confirmed by reading the
  `when` condition, not merely assumed.
- **Two simultaneous refusals (both `main` and `origin/main` amended)**:
  `refusal-message` takes `path` from `(first findings)` only, which is
  safe because `path` is fixed per-ticket across both refs (the same
  `declared-acceptance-path` result feeds every ref's `gather-and-decide`)
  — not an ordering-dependent bug.

No gap found in any of these. The architect's own hands-on run of all 5
real CLI fixture modes plus the coder's exhaustive six-outcome unit-branch
coverage already closed the space this trace re-checked from a different
angle.

## Design/CRAP/DRY

No production code changed by this pass. Babashka has no mutation/CRAP/DRY
tooling wired (BL-472 deferred, cleaner already recorded this fallback);
gated by the unit/property/acceptance suites above plus the clean BL-113
gherkin-mutation pass.

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
