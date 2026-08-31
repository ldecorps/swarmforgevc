# Specifier ruling — BL-1298 QA hold upheld; the machinery defect is ticketed
2026-08-31

QA note, priority `00`: "BL-1298 QA HOLD - replay pulls bounced BL-1303
content, see evidence"
(`backlog/evidence/BL-1298-qa-hold-land-step-blind-spot-20260831.md`).

## Ruling

**The hold is correct on every count. Upheld. No rework is owed to BL-1298's
chain, and no bounce is warranted.** The residual machinery defect QA
identified is real and was unticketed; it is now **BL-1315**
(`backlog/paused/BL-1315-the-replay-tip-carries-only-the-ticket-being-landed.yaml`,
`severity: high`).

## QA's central claim, verified independently

Not taken on trust. Checked directly against the refs, from the master
checkout on `main`:

    git cat-file -e origin/main:swarmforge/scripts/check_feature_handler_registration.sh
      -> ABSENT from origin/main
    git cat-file -e land-replay/BL-1298-86c2ed1c2d:swarmforge/scripts/check_feature_handler_registration.sh
      -> PRESENT on the replay tip

`git diff --name-only origin/main land-replay/BL-1298-86c2ed1c2d` also carries
BL-1303's five `extension/src/tools/featureHandlerRegistration*` files, its
step handler, its `run_commit_guards.sh` wiring and its four test files.
Landing the tip as cited would ship BL-1303's guard implementation onto
`origin/main` under BL-1298's ticket, bypassing BL-1303's own QA gate — and
specifically the version the architect bounced, since the `pre-merge-commit`
wiring that bounce demanded is not on it.

## Why not a bounce

No role in BL-1298's chain owns a fix. `land_step_lib.bb` and
`task_scope_gate_lib.bb` are shared swarm machinery, and BL-1298 is itself part
of the tooling this remedy runs on — it cannot be asked to close its own
tooling's remaining hole inside its own parcel. QA's refusal to hand-strip the
tip is also right, and is what `QA.prompt` requires.

## Why no expedite, and why this self-resolves

BL-1303's corrected parcel is moving, verified this turn: the cleaner forwarded
commit `4e3172dc96` to the architect at 04:33:20Z
(`.worktrees/cleaner/.swarmforge/handoffs/sent/00_20260831T043320Z_000215_from_cleaner_to_architect.handoff`),
and the coder's `652603514d` adds the `pre-merge-commit` wiring the architect's
D1 bounce demanded. Once BL-1303 lands, BL-1303's files on the replay tip
become byte-identical to `origin/main` rather than novel, and `86c2ed1c2d`
lands as cited with no re-work. Re-running `land_step_cli.bb` on the same
commit is the whole unpark procedure.

So: no `expedite.sh`, no re-cite, no hand-strip.

## Bookkeeping — the park is recorded in the TICKET, not only here

`backlog/active/BL-1298-...yaml` `notes:` now carries the park, the unpark
condition and an explicit "no rework is owed". State that lives only in an
evidence file invites a wrong demote later. The ticket deliberately stays in
`backlog/active/`: `backlog/hold/` silences the approval sweep, which scans
active and paused only, and produces the stale-park shape BL-1300 and BL-1307
both hit.

This is a bookkeeping-only amendment. Nothing anyone builds changes, so it is
not a rebuild and needs no merge-and-re-read from BL-1298's holder.

## The machinery defect: BL-1315, and why it was not already covered

QA named the root cause correctly: the detector reported BL-1303, and the
replay's own-path set swept its content in anyway. Checked against all three
neighbours before minting:

- **BL-1297 (done)** gave `:delivered` a real diff where it previously returned
  nothing for a merge. This is that fix being too WIDE — the residual, not a
  regression.
- **BL-1308 (done)** widened the DETECTOR only, and says so in its own source:
  `land_step_lib.bb:88-90`, "Only DETECTION widens here.
  `own-commit-changed-paths` and `task-tagged-changed-paths` are untouched".
  Its written guidance was to check the tip by hand. That check has now been
  run by hand twice in two days.
- **BL-1309 (paused)** blocks the mandatory land step when the tip carries
  unlanded content. That is the safety net; it does not let an entangled parcel
  land its own work. Sibling, not prerequisite.

Nothing covered the path set. BL-1315 is that slice, carrying two invariants
that make the known hazard impossible: no path the landed ticket's own chain
delivered is ever dropped, and an attribution that cannot be read refuses the
land rather than silently narrowing the tip. `ruling_options` puts the real
fork to the human — narrow by attribution, or accept serialization and let
BL-1309 be the whole answer.

## Mechanism reading, for the record

`land_step_lib.bb:205` `own-paths` -> `task_scope_gate_lib.bb:386`
`task-tagged-changed-paths`: candidates from
`git rev-list --first-parent origin/main..<tip>`, filtered to commits whose
subject names the ticket, each expanded with `own-commit-changed-paths
... :delivered`. For a merge, `:delivered` is a two-tree diff against the FIRST
parent, so it returns everything the SECOND parent brought in. A role's
forward-merge takes its subject from the ticket it forwards, so a sibling's
work riding that branch enters the tip under the forwarded ticket's name.
