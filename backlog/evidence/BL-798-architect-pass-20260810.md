# BL-798 architect review — clean pass, NONE (rework, bounce D1 resolved)

**Ticket:** BL-798 — open-slot nudge names its top candidate, escalates
promotion inaction.
**Reviewed commits:** fc82d56f1a (coder, invariant 2 property fix) forwarded
unmodified by cleaner as `merge_and_process cleaner 5117f81ecd`; merged with
`main` (03c4ee5a5) in this review to pick up the specifier's out-of-band
invariant 3 prose landing (4758e3387), per "A Prior QA Bounce Is Not In Your
Worktree — Check It Against `main`" and "Amending An In-Flight Ticket's Spec".
**Role:** architect.

## Prior bounce (D1, invariant-unencoded) — resolved

`backlog/evidence/BL-798-architect-bounce-20260810.md` bounced 6c97e2eeee for
invariant 2 (bounded escalation, quiet after) having only 7 hand-picked
example assertions, no generative property test, no stated non-encodability
reason. The coder's rework (fc82d56f1a) adds
`swarmforge/scripts/test/bl798_open_slot_escalation_property_runner.bb`,
mirroring `provider_auth_observe_lib_property_runner.bb`'s P1/P2 shape.

Re-verified independently in this review, not just taken on the commit
message's word:
- Ran it: `bb swarmforge/scripts/test/bl798_open_slot_escalation_property_runner.bb`
  — 500 runs/property, generator coverage both sides of the threshold
  (494/786 buckets), `ALL PROPERTIES HOLD`.
- Non-vacuity re-proven by hand, not just trusted from the commit message:
  changed the `(not (:escalated state))` guard in
  `decide-open-slot-escalation` to `true` (removing the "go quiet after
  escalating" behavior) — P1 failed on the first generated over-threshold
  episode (`escalate` repeating every tick instead of once), confirmed
  `git diff` clean after restoring.
- `swarmforge/scripts/chase_sweep_lib.bb` and `handoffd.bb` are byte-for-byte
  unchanged since the bounced commit (`git diff 6c97e2eeee HEAD --
  chase_sweep_lib.bb handoffd.bb` empty) — the production code already
  reviewed clean in the D1 pass carries forward unmodified; only test
  coverage was added.

## Invariant 3's spec-gap (noted, not bounced, in the D1 pass) — also resolved

D1's evidence separately flagged (as a spec-gap `note`, not part of the
bounce) that invariant 3's actual deliverable — a `coordinator.prompt`
never-clear-without-cause duty — had not landed, and that this ticket's
`required_stages` structurally cannot schedule the specifier to deliver it.
Landed out of band on `main`:
- `4758e3387` — "## Never Clear An Open-Slot Nudge Without A Cause (BL-798
  invariant 3, SUP-1)" in `coordinator.prompt`.
- `03c4ee5a5` — a new specifier.prompt rule ("A prompt/constitution
  deliverable is YOURS to land, and no gate will remind you") so this class
  of gap doesn't recur on a future ticket.

Verified, not just trusted:
- The nudge message shape the prose cites (`"open slot + paused work -
  promote+route"` + `" awaiting approval"` suffix) matches
  `chase_sweep_lib.bb`'s `open-slot-nudge-phrase` and the `:approved?`
  suffix logic byte-for-byte (grepped both).
- The claimed default threshold (3) matches
  `open-slot-escalation-default-threshold` in `chase_sweep_lib.bb`.
- The claimed post-escalation silence behavior (`handoffd.bb` sends nothing
  further for that candidate until the top candidate changes) matches
  `decide-open-slot-escalation`'s `:escalated` guard, already covered by P2
  above.
- The ticket's own YAML `notes:` records the landing with both commits —
  the durable record the amendment itself calls for. This changes no
  scenario or step-handler work, consistent with the amendment's own claim.

Merging `main` pulled in only these two commits (`git log --oneline
HEAD..main` before the merge showed exactly `03c4ee5a5` and `4758e3387`,
nothing else) — a clean, narrowly-scoped pickup, not a broad main sync.

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **Dependency-rule gate (BL-259, hard gate).** Touched files this rework
   adds/changes: `chase_sweep_lib.bb` (unchanged, see above),
   `handoffd.bb` (unchanged), `test/dispatch_gap_test_runner.bb`,
   `test/bl798_open_slot_escalation_property_runner.bb`,
   `roles/coordinator.prompt`, `roles/specifier.prompt` — none under
   `extension/src` or `extension/media`. Ran `dependency-gate.js` directly
   against all of them: same "can't open" scope error as BL-812/BL-800's
   precedent (`.bb`/`.prompt` are outside the compiled-extension-tree scope
   the gate checks). NO-OP, not skipped.

2. **Co-change / logical coupling (BL-255).** Ran `co-change-report.js`
   against `chase_sweep_lib.bb`, `handoffd.bb`, `coordinator.prompt`,
   `specifier.prompt`. All top hits are this subsystem's known existing
   shape (chase-sweep test runners, `handoff_lib.bb`, `mono_router_lib.bb`,
   sibling role-prompt files, `specs/pipeline/steps/index.js`) — same
   coupling picture as the D1 pass, nothing new or cross-boundary.

3. **Two-layer / IO-ownership / integrate-not-fork rules:** not implicated —
   swarm-scripts and role-prompt files only (maintained fork), no
   extension/webview/upstream SwarmForge source touched.

4. **Correctness read.** Production code identical to the already-clean D1
   pass (item above). The two new prose sections were verified against the
   real code they describe (message format, default threshold, escalation
   quiet-after), not just read for internal consistency.

5. **Declared invariants (BL-654), three distinct passes:**
   - **Invariant 1** (nudge names the Article-3.2.4-ranked top candidate):
     unchanged since the D1 pass — still transitively covered by
     `promotion_gates_lib_property_runner.bb`'s P4 plus direct example
     assertions and a real-file-backed round-trip. Adequate.
   - **Invariant 2** (bounded escalation, quiet after): **was D1, now
     resolved** — see above.
   - **Invariant 3** (coordinator never clears without promoting or
     recording a blocking reason): non-encodability carve-out stands
     (quantifies over coordinator prose/process, not a pure module); its
     prose deliverable, previously missing, is now landed and verified
     accurate against the code — see above.

6. **Example-test re-run.** `bb
   swarmforge/scripts/test/dispatch_gap_test_runner.bb` — `ALL PASS:
   chase_sweep_lib.bb dispatch-gap functions`.

## Property Testing pass (architect-owned, undeclared properties)

The rework's only production-adjacent addition is the property runner
itself, which is the declared-invariant fix, not new undeclared surface.
`chase_sweep_lib.bb`/`handoffd.bb` are otherwise unchanged from the D1 pass,
where no further property-shaped gap was found on the touched surface.
Nothing further to add.

## Handoff

Forwarded to hardender, same task name, commit is this worktree's HEAD after
merging cleaner's `5117f81ecd` and `main`'s `03c4ee5a5` (both merges clean
fast-forward/no-conflict) plus this evidence commit.
