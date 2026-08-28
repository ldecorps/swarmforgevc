# BL-1205 hardener pass — 2026-08-28

## Reviewed commit

Merged architect's `3d4ce65ae0` (cleaner `2815d0788b`, on coder's bounce
re-fix `0a43319fd3` adding the fixture-cleanup finally blocks the
architect's D1 bounce required) clean into hardender, no conflicts.

## Verification (re-run directly)

- `npm run compile` — clean.
- `bb .../tree_collapse_guard_lib_test_runner.bb` — ALL PASS.
- `bb .../bl1205_tree_collapse_guard_property_runner.bb` — 2000 runs, ALL
  PROPERTIES HOLD.
- `node specs/pipeline/cli.js specs/features/BL-1205-...feature` — 9/9
  scenarios pass against the real `swarm_handoff.bb` /
  `tree_collapse_guard_lib.bb` call chain, real fixture git repos.
- Re-verified the fixture-leak fix independently: `rm -f
  /tmp/bl1205-tree-collapse-*` then re-ran the acceptance suite — `ls /tmp
  | grep -c bl1205-tree-collapse` reads `0` after, confirming cleaner's own
  independent verification.

## BL-113 Gherkin mutation (soft) — one accepted equivalent

The one `Scenario Outline:` (5 examples, `recipient` parameterized across
every pipeline role) mutated 5 cells; 4 killed, 1 survived:
`examples[4].recipient: "QA" -> "qA"`.

**Ruled equivalent, per BL-234's own code-level-demonstration bar — not a
gap.** Grepped `tree_collapse_guard_lib.bb`,
`bl1205HandoffRefusesAMassDeletionForwardSteps.js`, and the relevant
region of `swarm_handoff.bb` for any `"QA"`-specific branch: none exists
in this guard's own logic. The lib's own header comment names the GAP this
ticket closes as pre_qa_gate_lib's existing QA-only arming — tree_collapse_
guard_lib.bb deliberately treats every recipient identically (invariant 1:
"no hop is exempt"), and the step handler's `writeRoles`/`branchRoleRow`
use the recipient string as an arbitrary branch-name suffix with no case
normalization or special-casing anywhere. A mutated case on this one
parameterized value cannot be distinguished from the original by any
assertion this scenario could write, because the code path it exercises is
byte-for-byte the same regardless of case — the exact BL-234 shape ("the
code path provably treats the whole value-class identically"), not a
convenient dismissal: I read the guard's actual dispatch logic before
concluding this, not just its comments.

Not a case-insensitive-filesystem artifact either (checked: this is a
Linux host, `qA-branch` and `QA-branch` are genuinely different git refs
here) — the equivalence is structural (no code reads the recipient string
for anything but branch-name construction and role.tsv lookup, both
case-preserving and case-blind to any specific value), not host-masked.

Manifest note: this scenario's own `scenarios:` entry in the embedded
mutation-stamp is correctly empty per BL-502 (a scenario with any
survivor, accepted-equivalent or not, is omitted from the clean-scenario
list) — expected, not a sign the tool didn't run.

## Unrelated pre-existing red observed in this merge (not this ticket's)

This merge also carried BL-1204's own bounce-fix content (a sibling
ticket bundled via the same architect-worktree history, not part of
BL-1205's own diff). Running its test suite showed
`telegramCursorOperatorExec.test.js`'s "BL-698: ambulance engage and
release via execute" failing. Already investigated and disposed by the
architect in `backlog/evidence/BL-1204-architect-bounce-20260828.md`:
confirmed pre-existing (byte-identical test content before/after BL-1204's
own commit) and caused by ambient backlog fixture state, not this parcel.
Not re-diagnosed here; not this ticket's finding.

## Disposition

Hardened. Fixture-leak fix (architect's D1 bounce, cleaner's re-fix)
independently re-verified. One Gherkin-mutation survivor investigated and
correctly ruled equivalent from the code, not dismissed. Forwarding to
documenter.

By hardender.
