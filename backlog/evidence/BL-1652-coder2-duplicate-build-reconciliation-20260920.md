# BL-1652 coder@2: duplicate-build discovery and reconciliation

The Work note dispatched to this seat (coder@2) named BL-1652, already
merged main first per the standing rule. Independently built a full
implementation (commit 4eacde9068, local-only, never sent — see below) and
only discovered at handoff time that a SIBLING coder seat had already built
and forwarded the same ticket (commit 43213a6bc2), which by then had
already cleared cleaner, architect, and hardener review and reached
documenter (ba49c91ed6, ~33 minutes end to end, overlapping this seat's
own build almost exactly).

`swarm_handoff.sh` correctly refused this seat's own `git_handoff` for
BL-1652 ("a live parcel for this ticket already exists at documenter") —
no duplicate was ever delivered downstream. Sent a `note` (priority 00) to
coordinator and specifier flagging the duplicate dispatch for triage
(matches the known coder@2/shared-mailbox class of hazard). Completed the
now-moot Work note plainly (real, evidenced commit exists on this branch,
even though unsent).

A subsequent `git_handoff` from cleaner then reverse-hopped a
`non-forwarding: true` merge-only handback to this seat naming
`merge_and_process cleaner 0ace704af1` — the sibling's own reviewed tree.
Per Article 2.4, the inbound tree is the structure: merged it, resolved
the four resulting conflicts (`chase_sweep_lib.bb`, `handoffd.bb`,
`chase_sweep_test_runner.bb`, the BL-1652 step handler — an add/add
collision, same filename, independently authored) by taking the sibling's
side entirely, and discarded this seat's own competing implementation.

Kept one artifact from this seat's own build that survived contact with
the adopted tree unmodified in spirit: `test/
test_handoffd_bl1652_chase_respawn_busy_lane_guard.sh`, a real end-to-end
wiring test driving the actual `handoffd.bb --chase-sweep-once` against a
fake tmux and, for the lane scenario, a real `exec -a vitest` process
scoped to the role's own worktree — genuinely additive (the sibling's own
test battery is JS/property-test based, with no such shell-level wiring
test), registered in `suite-manifest.tsv`. Needed one regex fix (the
adopted `chase-respawn` log line orders the launch-script path before the
reading fields, not after); re-verified green against the adopted tree.
Reverted this seat's own edits to `test_chase_sweep.sh` back to its
pre-BL-1652 baseline (cases 18-20, and the line-80 assertion tweak) since
they depended on env-var names this seat's own `chase_sweep_test_runner.
bb` changes introduced, which the adopted tree does not carry (it keeps
the pre-BL-1652 `respawn <role>` line byte-identical and logs the new
readings on a SEPARATE `respawn-readings` line instead) — matches the
hardener's own evidence, which counts `test_chase_sweep.sh` at 17 cases,
unchanged.
