# BL-953 architect pass — 2026-08-19

Reviewed: coder's implementation (`task_commit_coherence_gate_lib.bb`,
`bl953TaskCommitCoherenceSteps.js`, `bl953_task_commit_coherence_property_runner.bb`,
`task_commit_coherence_gate_lib_test_runner.bb`, and the wiring change to
`swarmforge/scripts/swarm_handoff.bb`'s `validate`), merged by cleaner in
`2aa0df2b6a`.

## Scope

`swarm_handoff.bb`'s `validate` gains a fourth send-time guard
(`coherence-block`, alongside BL-760's duplicate-chain, BL-806's
review-forward-evidence, and the pre-QA/pointer gates): a `git_handoff`
whose `commit:` subject positively names a ticket id different from the
one `task:` resolves to is refused. Reads only the cited commit's own
subject (`git log -1 --format=%s`) — deliberately not a merge's
second-parent side, per the lib's own documented probe against the real
Article 2.6 batch-forward hashes, which would have wrongly blocked that
lawful case at depth.

## Correctness — a concern I raised and resolved myself, not assumed

The new call introduces `swarm_handoff.bb`'s only DIRECT `clojure.java.shell/sh`
call outside the existing `command` helper. This project has a documented,
empirically-observed deadlock class with exactly this primitive
(`handoffd.bb`'s own header comment: "bb's clojure.java.shell shim can
deadlock reading subprocess streams... BL-061", root-caused in a prior
session as a repeated-sh-calls-in-one-process pattern in `notify!`).
Investigated before accepting: `swarm_handoff.bb` already wraps `sh` via
its own `command` helper (line 59-62), called repeatedly on every send
already (`canonical-commit` alone calls it 3 times) — this is the file's
established, working, hot-path convention, not a new risk. BL-953's call
follows the same single-small-output-git-subprocess shape. Confirmed live,
not just reasoned: both the property runner (2000 runs, real
`swarm_handoff.bb` subprocess sends) and the acceptance suite (8 real
sends, including a background retry after a load-induced 2-minute timeout
that cleared on a clean re-run) completed without hanging.

## Non-vacuity — independently reproduced, not taken on the commit message

Reverted `swarm_handoff.bb` to my pre-BL-953 HEAD in this worktree and
re-ran the acceptance feature: 4/8 fail (exactly the scenarios that depend
on the gate: the incident reproduction, the dual-ticket refusal message,
the cleaner-hop refusal, and the fail-open warning line — the other 4,
which don't exercise the new guard, still pass). Restored the fix
afterward (`git status` clean).

## Dependency-rule gate (BL-259, hard gate)

No `extension/src`/`media` file touched. `node extension/out/tools/dependency-gate.js`
against the changed files errors ("can't open") because none resolve
under `extension/` — not applicable to this parcel, confirmed rather than
assumed.

## Co-change report (informational)

`swarm_handoff.bb` shows its usual hub-file coupling (`index.js`,
`handoffd.bb`, `required_stages_lib.bb`, etc. — all pre-existing, unrelated
to this specific change). The new files
(`bl953TaskCommitCoherenceSteps.js`, `task_commit_coherence_gate_lib.bb`)
show no co-changers (new files). Nothing flagged as specific to this
parcel.

## Invariants (all 3 declared)

1. **"Fail-open is absolute"**: pure `blocked?` truth table
   (`task_commit_coherence_gate_lib_test_runner.bb`, includes every
   ambiguous shape — nil ids, empty ids, unresolvable task ticket, the
   Article 2.6 batch case) plus the property runner (2000 generated runs,
   583 refusing shapes, 387 constructed collisions). Non-vacuity stated at
   authoring time (prefix-match substitution fails the collision property
   immediately) — I verified the acceptance-level non-vacuity myself above
   rather than re-deriving the unit-level claim.
2. **"Ticket identity is exact id equality, never prefix or substring"**:
   collision pairs built BY CONSTRUCTION in both the unit runner
   (BL-93/BL-935, BL-95/BL-953 — the exact naming-trap the ticket calls
   out) and the property runner (every generated pair is a
   prefix-collision candidate). Reuses `pipeline-stage-lib/extract-ticket-id(s)`
   rather than a second parser, per the ticket's own direction — confirmed
   by reading the require and call sites, not assumed.
3. **"A refused send has no side effects"**: acceptance scenario 02 asserts
   zero files under any `inbox/new/` after a refused send, on a REAL send
   through the real mailbox machinery. NOT encoded as a property test —
   the property runner's own header states why (it quantifies over
   `validate`'s shared refusal machinery in `swarm_handoff.bb`, not over
   the pure decision's input space) — a stated, correct non-encodability
   reason, not an omission.

## Required wiring (BL-259-shaped gate on THIS ticket's own `required_wiring`)

Confirmed by reading, not assumed: `swarm_handoff.bb` line 20 loads
`task_commit_coherence_gate_lib.bb`; `validate` computes `coherence-block`
(lines 305-319) and folds its refusal into `git-errors` (line 352-353),
beside the BL-760/BL-806 guards. `specs/pipeline/steps/index.js` registers
`bl953TaskCommitCoherenceSteps` (resolved the merge conflict there myself
— cleaner's line and BL-951's own registration both needed to survive;
union, not override). The acceptance suite proves the wiring is live (real
subprocess sends through the real `validate`), not merely that the lib's
own unit tests pass in isolation.

## Merge notes (two QA merge-up broadcasts landed in this worktree just before this parcel)

Before this parcel arrived, I processed two QA merge-up notes in this same
session — BL-620 (`6f3193846`) and BL-951 (`9b0c3d9ae`) — and the first one
surfaced a real hazard worth flagging here since it bears on how I verified
THIS merge too: QA's BL-620 branch descended through BL-952's own
bounce-revert commit (`ccd94e3eb`, BL-490/BL-495), and because my side was
byte-identical to the 3-way merge-base for every BL-952-touched file, git's
merge silently took the revert — dropping BL-952's active fix from the
working tree with no conflict marker to flag it. Caught and hand-repaired
before committing (see that merge commit's own message for detail). Applied
the same discipline to this BL-953 merge: diffed every at-risk file
(`is_qa_ancestor.sh`, `Specification.MD`, the evidence files) against my
pre-merge HEAD after resolving the `index.js` conflict — all clean, nothing
dropped this time.

## Verdict

COMPLIANT. Forwarding to hardener.

By architect.
