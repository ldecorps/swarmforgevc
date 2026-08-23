# BL-1076 — architect pass

Received from cleaner as `merge_and_process cleaner 6191ce9c7e` (cleaner
forwarded coder's fix commit `e591f5078` unchanged — `git diff --stat
e591f5078 6191ce9c7e` is empty, clean pass, no cleanup needed).

## Required hard gate — dependency-rule checker (BL-259)

This parcel touches no `extension/` TypeScript. Full-repo scan
(`node out/tools/dependency-gate.js`, no args, per
[[bl259-dependency-gate-and-npx-namespace-trap]]'s straddling-boundary
guidance) reports one pre-existing `acyclic` cycle among
`telegram-front-desk-bot.ts` / `telegramCursorOperatorExec.ts` /
`telegramCursorOperatorLiveness.ts` — none of which are in this parcel's
changed-file set (confirmed via `git diff --name-only fbea96a60f
6191ce9c7e`). Baseline debt, not introduced here; not this parcel's to fix.

## Co-change coupling (BL-255)

Ran against all changed files. Reported "SUSPECTED COUPLING" is exactly the
file set the ticket's own Scope section names as co-edited
(`batch_claim_progress_lib.bb` ↔ `chase_sweep_lib.bb` ↔ `handoffd.bb` ↔ the
harness/test-runner/conf/doc files) — expected structural coupling for a
daemon-sweep feature, not accidental drift.

## required_wiring — all six anchors checked in code, not prose

| anchor | verified |
|---|---|
| `index.js::bl1076BatchClaimVisibleWorkSteps` | `require` line added at `specs/pipeline/steps/index.js:601` |
| `batch_claim_progress_lib.bb::"hardender"` | `role-stale-threshold-ms` map, `batch_claim_progress_lib.bb:57-58` |
| `batch_claim_progress_lib.bb::worktree-dirty` | 4th param of `decide-batch-claim-observation`, `:suppressed-visible-work` branch |
| `handoffd.bb::batch-claim-progress-suppressed` | `log!` call, `handoffd.bb:2055` |
| `swarmforge.conf::batch_claim_progress_role_stale_threshold_minutes` | documented beside its two sibling keys |
| harness `::worktree-dirty` | `(def worktree-dirty? ...)` + passed into the real sweep call |

## Invariants Review (BL-633/654) — all three pre-existing as executable properties, non-vacuous

`bl1076_visible_work_gate_property_runner.bb` encodes all three declared
invariants (P1/P2/P3) plus an armed-ness backstop (P4) and the shipped
defect stated absolutely (P5), each asserted against real filesystem state
after a real `apply-batch-claim-progress-check!` sweep, not the pure return
value alone — the right posture, since a third label is exactly the shape
that can satisfy each invariant vacuously (defer the clock, drop the
observation, suppress everything).

Ran it myself rather than trusting the coder's evidence numbers:

```
bl1076 visible-work-gate properties: 240 runs, coverage {:defect-band 19,
:past-tolerance 165, :under-base 71, :label-silent 120, :label-suspect 68,
:label-suppressed 52, :role-hardener 123, :role-other 117}
ALL PROPERTIES HOLD
```

Matches the coder's own numbers exactly. No hand-verification substituted
for a missing test — the test exists and bites (break-then-restore counts
documented in the runner's own header, each break kills its target
property).

## Property Testing pass (undeclared coverage)

No further property test warranted. `resolve-stale-threshold-ms` (the core
resolver) is already exercised under generation by the P1-P5 runner via
randomized role/override draws. The new conf-line parser
(`parse-batch-claim-progress-role-stale-threshold-ms`) is a simple
per-line regex parser, not a round-trip/encode-decode shape, and already
has 8 explicit boundary-case unit tests in
`batch_claim_progress_sweep_test_runner.bb` (malformed, non-positive,
missing minutes, repeated-role-last-wins, etc.) — adequate for what it is.

## Consumer sweep — re-verified exhaustive, not sampled

`apply-batch-claim-progress-check!` (4-arity → 5-arity) and
`decide-batch-claim-observation` (3-arity → 4-arity) both changed their
call signature. Grepped every `.bb` file for both function names myself:
every call site (`handoffd.bb`, the sweep harness, the property runner, the
lib test runner, the sweep test runner, BL-678's own property runner) is
updated to the new arity, including BL-678's own runner explicitly passing
`false` for worktree-dirty? — matching the ticket's own note that BL-678's
fixture reads clean, so its scenario 04 stays green for the right reason.

## Verification run myself (not just re-reading the coder's evidence)

| check | result |
|---|---|
| `run_acceptance.sh BL-1076…feature` | 11/11 pass |
| `run_acceptance.sh BL-678…feature` | 5/5 pass, unchanged |
| `bl1076_visible_work_gate_property_runner.bb` | ALL PROPERTIES HOLD (240 runs, counts match) |
| `bl678_batch_claim_progress_invariants_property_runner.bb` | ok |
| `batch_claim_progress_lib_test_runner.bb` | ok |
| `batch_claim_progress_sweep_test_runner.bb` | ok |
| `test_batch_claim_progress_sidecar.sh` | ALL PASS |
| `test_handoffd_chase_sweep_wiring.sh` | ALL PASS |

## Architecture rules

Two-layer/webview/host-I/O/browser-storage/secrets boundaries: not
applicable — this parcel touches no `extension/` code, only the
`swarmforge/` daemon (a maintained fork this swarm's own reliability epic
owns per architecture rule 2, not an unmodified upstream dependency).
Dependency direction is correct: the pure decision (`decide-batch-claim-
observation`, `resolve-stale-threshold-ms`) stays free of I/O; the impure
sweep/log/conf-read layer (`apply-batch-claim-progress-check!`, `handoffd.
bb`) depends inward on it, never the reverse.

## Correctness read

No defect spotted beyond what the ticket already names. The one design
call flagged for review (retiring the dirt-blind 3-arity rather than
defaulting `worktree-dirty?` to `false`) is the right call for exactly the
reason stated — a forgotten flag at a call site would silently reopen this
same defect — and the consumer sweep above confirms no call site was
missed.

## Verdict

COMPLIANT. No violation, no correctness defect. Forwarded to hardener.
