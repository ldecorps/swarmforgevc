# BL-911 — architect pass, follow-up observation (not a bounce)

Reviewed commit 9adb071fc3 (coder 818bd3826, cleaner pass-through, merged to
architect at 62eb4ba08). The parcel is architecturally clean and does exactly
what the ticket's own "How" section scoped: `rotate-resident-to!` in
`swarmforge/scripts/handoff_lib.bb` is the correct, complete chokepoint for
BOTH named rotation drivers (the resident's `rotate_to_role.bb` path via
`respawn-as!`, and `handoffd.bb`'s daemon-driven chase at line 1336, which
calls `rotate-resident-to!` directly). Verified independently, not just
trusted from the evidence file:

- `bl911_rotation_recompose_test_runner.bb` — ALL TESTS PASSED (re-ran).
- `test_rotate_recomposes_role_prompt.sh` — all 4 scenarios PASS (re-ran).
- `run_acceptance.sh` on the feature file — 7/7 scenarios pass (re-ran).
- `handoff_lib_test_runner.bb` and `test_rotate_to_role_stuck_parcel_gate.sh`
  (BL-805) — unaffected; the latter's own fixture now correctly exercises
  the new no-metadata-sidecar degrade path and still passes all 8 checks.
- `dependency-gate.js` full-repo scan: pre-existing, unrelated cycle in
  `telegram-front-desk-bot.ts` — no file this parcel touched is involved.
- `co-change-report.js` on the changed files: expected chokepoint coupling
  for `handoff_lib.bb` (a file that co-changes with `handoffd.bb`,
  `swarmforge.sh`, etc. on every prior ticket too) — nothing new.
- Both declared invariants: stated non-encodability reason is legitimate
  (Babashka has no property-test framework wired, same precedent as
  BL-812/BL-795); the properties they describe ARE covered — invariant 1 by
  acceptance scenarios 01/02, invariant 2 by pure unit tests 01/04/05/06 plus
  acceptance scenario 03 — all re-run and genuinely green above.

## The observation

Swept for other sites where the same underlying property ("a pane about to
boot reads a prompt freshly composed from current sources") could still be
violated. Found one: `respawn-self!` (same file, `handoff_lib.bb:662`),
called from `ready_for_next_task.bb`/`ready_for_next_batch.bb`'s
`maybe-clear-at-idle-boundary!` (BL-089) whenever a role finishes a task,
stays the SAME role (does not rotate home to a different role), and that
role's roles.tsv row has the idle-clear opt-in column set to `on`. It
re-execs the role's own launch script — the same `respawn-pane -k ... zsh
'<script>'` shape `rotate-resident-to!` uses — but does not call
`recompose-role-prompt!` first, so it boots on whatever `.swarmforge/prompts/
<role>.md` already held.

This is the same class of staleness the ticket exists to fix, just via a
third entry point the ticket's "How" section didn't name (it named exactly
two: the resident's `rotate_to_role.bb` path and the daemon's chase). Under
continuous-shift operation, the home role (coder, per the mono-router
overlay) is the role most likely to sit resident through many task
completions without ever rotating away and back — exactly the situation
where a rule proposal landed into that role's own prompt would stay
invisible longest.

**Currently inert, not an active defect**: checked this live swarm's
`.swarmforge/roles.tsv` — every role's idle-clear column reads `off`. Since
`idle-clear-enabled?` is opt-in and default-off (per its own docstring),
`respawn-self!` never fires on this swarm today, so nothing ships broken.

## Why this is a note, not a bounce

The coder implemented exactly what the ticket's "How" section specified,
completely and correctly, with real (not vacuous) test coverage. Expanding
scope to a third entry point the specifier didn't name is a scope decision,
not an implementation defect — routing it to the coder as a bounce would
authorize work outside this ticket (the same concern "An Approval
Authorizes Only Its Ticket's Work" exists to prevent). This mirrors the
ticket's own precedent: it explicitly named `.swarmforge/launch/<role>.sh`
as an adjacent, out-of-scope staleness source and deferred it to "a
follow-up ticket... not this slice." `respawn-self!` is the same shape of
adjacent gap.

Sent as a `note` (priority 50, non-blocking — idle-clear is off everywhere
today) to specifier and coordinator, for the specifier to judge whether it
warrants a follow-up ticket.

By architect.
