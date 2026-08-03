# BL-795 — coder adopt pass

Adopts the hand fix described in
`backlog/evidence/hotfix-2026-08-03-mono-router-starvation.md` into the
`coder` worktree, scoped to exactly the three declared invariants. The
master working tree's uncommitted diff for `handoffd.bb` also carried the
2026-08-02 start-of-cycle heartbeat pulse (BL-789); that hunk was
identified and excluded — confirmed by diffing the adopted files against
the master tree afterward (no heartbeat-pulse hunk present).

## Files adopted

| File | What was applied |
|---|---|
| `swarmforge/scripts/mono_router_lib.bb` | `actionable-mail?` treats `rule-proposal-count` as an equal peer of `git-handoff-count`/`in-process-count` |
| `swarmforge/scripts/handoffd.bb` | `role-mail-row` includes `rule_proposal` in the actionable set; `chase-rotate-to!` redirects to the preferred role via new `attempt-resident-rotate!` helper instead of returning `not-preferred` (BL-789 heartbeat-pulse hunk excluded) |
| `swarmforge/scripts/chase_sweep_lib.bb` | `"alert"` branch of `sweep-in-process!` still calls `apply-stuck-nudge!` after arming escalation |
| `swarmforge/scripts/test/mono_router_lib_test_runner.bb` | rule_proposal-actionable + no-regression assertions |
| `swarmforge/scripts/test/test_chase_sweep.sh` | scenario 06 rewritten to expect post-alert wake + nudgeCount advance |
| `swarmforge/scripts/test/test_handoffd_rule_proposal_rotate_wiring.sh` | adopted verbatim (byte-identical diff against master) |

## Existing shell/bb test runs (ticket's e2e QA procedure, steps 1-3)

```
$ bb swarmforge/scripts/test/mono_router_lib_test_runner.bb
mono_router_lib_test_runner: ok

$ bash swarmforge/scripts/test/test_chase_sweep.sh
... (19 scenarios)
PASS: 06: in_process work exhausted across maxChases escalates and keeps waking
...
ALL PASS

$ bash swarmforge/scripts/test/test_handoffd_rule_proposal_rotate_wiring.sh
PASS: A: rule_proposal-only mailbox is preferred (immediately actionable)
PASS: B: fresh note alone stays non-actionable (broadcast-thrash guard intact)
PASS: C: in_process priority-00 beats rule_proposal priority-50 (held claim wins)
ALL PASS: test_handoffd_rule_proposal_rotate_wiring.sh
```

Also re-ran the wider related suite for regressions on the shared functions
touched (`role-mail-row`, `actionable-mail?`, `chase-rotate-to!`,
`sweep-in-process!`): `test_handoffd_chase_sweep_wiring.sh`,
`chase_activity_nudge_test_runner.bb`, `mono_router_lib_property_runner.bb`
(pre-existing BL-651 properties), `handoff_lib_test_runner.bb` — all green.

`test_handoffd_starve_rotate_wiring.sh`, `test_handoffd_priority_rotate_wiring.sh`,
`test_handoffd_aged_note_rotate_wiring.sh`, and `test_rule_proposal.sh` fail
in this dev environment (macOS system `/bin/bash` 3.2 has no `mapfile`
builtin; no live tmux socket) — confirmed pre-existing by running the same
scripts against the unmodified pre-adopt tree (`git stash`), identical
failures. Not a regression; environment-only.

## BL-654 declared-invariant coverage

Ticket declares three invariants. Per coder.prompt's Invariants section,
first authorship of each invariant's property test rests with the coder.

1. **"A directed rule_proposal ... is immediately actionable ... never sits
   forever behind chase-rotate-skip-broadcast."** — property test authored:
   `swarmforge/scripts/test/mono_router_actionable_rule_proposal_property_runner.bb`.
   Pure function (`actionable-mail?`), 500 generated runs over every
   count-map shape (absent/nil/0/positive per key), asserts equivalence to
   the plain boolean-OR oracle. Non-vacuity: run against the pre-fix
   3-key destructure (rule-proposal-count unbound) — failed on every
   rule-proposal-only input (`expected=true actual=false`); restored before
   commit.

2. **"A chase poke at a non-preferred role redirects the resident onto the
   preferred actionable role rather than returning not-preferred and
   dropping the rotate."** — **stated reason, no property test** (recorded
   in-code as a BL-795/BL-654 comment directly above `chase-rotate-to!` in
   `handoffd.bb`). The decision is inlined in an otherwise-impure function
   (`preferred-mono-rotate-role`/`role-mail-row` scan the real mailbox
   filesystem; `attempt-resident-rotate!` captures the live resident pane
   over a real tmux socket and performs the actual rotation) — not a pure,
   testable module, and extracting one would restructure the adopted file
   beyond this ticket's "adopt as-is" scope. Babashka has no property-test
   framework wired for this daemon-control-flow layer regardless. Encoded
   instead via the adopted real-fixture wiring test's scenario C, which
   proves the redirect's precondition (in_process priority-00 outranks
   rule_proposal priority-50) resolves correctly through the real
   `handoffd.bb --print-preferred-rotate-target` path.

3. **"Once stuck in_process work arms the chase alert / escalation, resume
   attempts continue; escalation does not permanently abandon a dormant
   mono-router holder."** — property test authored:
   `swarmforge/scripts/test/chase_sweep_alert_resume_property_runner.bb`.
   Drives `sweep-in-process!` against a real temp-dir fixture with fake
   adapters over 500 generated (nudge-count, idle-seconds) pairs; whenever
   the pure `decide-stuck-action` classifies a run as `"alert"`, asserts
   escalation fired true exactly once, a resume wake was attempted, and the
   nudge sidecar count advanced. Non-vacuity: run against the pre-fix
   escalate-only alert branch — every alert-classified run failed on the
   "resume wake attempted" assertion; restored before commit.

Both new property tests run clean (`ALL PROPERTIES HOLD`) against the
adopted fix and are wired into no CI path beyond direct `bb` invocation
(matching every other `*_property_runner.bb` in this directory — there is
no aggregate runner script).
