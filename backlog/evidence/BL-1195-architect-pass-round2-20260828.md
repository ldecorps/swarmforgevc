# BL-1195 architect pass — round 2 (2026-08-28)

## Reviewed commit

`f0365f1557` (coder re-fix, second round), via cleaner merge `fa62fc86cf`,
merged into architect with one conflict (ticket YAML `bounce_history` —
resolved by keeping both my prior entry, already recorded via
`record-bounce.js`, and the coder's remediation note; no code conflict).

## What changed since my last bounce

Previous round unioned the master-resident sibling's `in_process` mailbox
into the exemption — still refused whenever NEITHER master-resident role
held a dispatched parcel, which is hardener's own literal reproduction.
This round replaces that union with a full carve-out:
`enforce-worktree-drift-guard!` now skips the drift check entirely when
the invoking role's `worktree-name` is `"master"`. Reasoned, not
hand-waved: `commit_integrity_lib.bb`'s own header documents `master` as
a genuinely concurrent multi-writer surface by design (coordinator
bookkeeping, BL-topic-record writer, QA's fast-forward, specifier,
`operator_file_question.bb` — several of which have no handoff parcel to
point at even in principle), so no parcel-shaped signal can ever
distinguish a legitimate writer's WIP from real drift there. Matches
existing precedent — verified by grep, not taken on the commit message's
word: `check_branch_namespace.bb:45`, `post_qa_branch_sweep_lib.bb:45`,
and `pre_qa_gate_gather_lib.bb:145` already special-case `"master"` for
the same structural reason.

Named trade-off, explicit in the code comment and the ticket note: a
BL-1195-shaped silent-revert incident recurring specifically inside the
shared master checkout would no longer be caught by this guard. Every
other pipeline role's dedicated worktree keeps full original detection —
only the master-resident carve-out changes.

## Verification (re-ran hardener's own original reproduction, not just the shipped tests)

Ran the EXACT fixture from `backlog/evidence/BL-1195-hardener-bounce-20260828.md`
(specifier's WIP with no handoff parcel dropped anywhere) directly against
this commit:

```
$ SWARMFORGE_ROLE=coordinator bb .../ready_for_next.bb
INVALID_RECEIVE_MODE: guard-boundary-only for role coordinator
RC=2
```

No `WORKTREE_DRIFT_DETECTED` — control now reaches past the drift guard
(the `INVALID_RECEIVE_MODE` is my minimal fixture's own next-stage
artifact, not the guard). This is the first round where hardener's literal
repro actually passes.

## Also ran

- `worktree_drift_lib_test_runner.bb` — ALL PASS.
- `worktree_drift_lib_property_runner.bb` (100 runs) — ALL PROPERTIES HOLD.
- `test_worktree_drift_guard.sh` (original single-worktree scenarios) —
  3/3 PASS, no regression.
- `test_worktree_drift_guard_master_resident_exempt.sh` (renamed/rewritten
  regression suite, replaces the round-1 `_sibling.sh`) — 3/3 PASS,
  including scenario 06's control that a non-master role keeps full
  detection.
- No `extension/` files touched; dependency-cruiser gate N/A.
- Co-change on `ready_for_next.bb`: only pre-existing structural coupling
  to its own dispatch/wiring family (`swarm_handoff.bb`,
  `done_with_current*.bb`, `backlog_depth_lib.bb`, etc.) — nothing new
  introduced by this diff.

## Disposition

Architecturally sound, reasoned trade-off with precedent, and — unlike the
previous round — actually closes the literal reproduction the hardener
demonstrated, verified directly rather than trusting the commit message or
the shipped test alone. Forwarding to hardener.
