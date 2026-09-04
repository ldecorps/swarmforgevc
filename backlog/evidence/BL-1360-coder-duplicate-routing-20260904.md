# BL-1360 — ROUTED A SECOND TIME; ALREADY BUILT. No rebuild. 2026-09-04

The coordinator routed BL-1360 to the coder at 08:44Z ("Operator: BL-1360
promoted 08:06Z for you; read backlog/active/, build it"). **It was already
built, reviewed and forwarded on 2026-09-03.** Nothing was rebuilt.

## The evidence that it is already done

- Implementation commit `0b46b44b12` ("BL-1360: a ceremony handoff is composed,
  not retyped.") is an ancestor of this branch's HEAD. It adds
  `swarmforge/scripts/ceremony_handoff.sh`, `ceremony_handoff.bb`,
  `ceremony_handoff_lib.bb`, `test_ceremony_handoff_cli.sh`,
  `ceremony_handoff_lib_test_runner.bb`,
  `bl1360_ceremony_handoff_property_runner.bb`, the acceptance handler and its
  fixture CLI, and the suite-manifest rows.
- It has already TRAVELLED: `backlog/evidence/` holds
  `BL-1360-coder-20260903.md`, `BL-1360-cleaner-20260903.md` and
  `BL-1360-architect-pass-20260903.md`.
- `git branch --contains 0b46b44b12`: master, side, swarmforge-QA,
  swarmforge-architect, swarmforge-cleaner, swarmforge-documenter,
  swarmforge-hardender. It is on `origin/main`: **NO**. That is the only thing
  actually outstanding.
- Re-verified green today, on this tip, rather than assumed from the evidence:
  - `bash swarmforge/scripts/test/test_ceremony_handoff_cli.sh` — ALL CHECKS
    PASSED (5 checks).
  - `run_acceptance.sh` on the BL-1360 feature — 6/6.

The shipped composer defines THREE ceremonies — `merge-up`, `bookkeep` and
`spec-ready` — and its own self-audit records closing a `spec-ready` coverage
gap before forwarding.

## What went wrong here, recorded because it is repeatable

`backlog/active/BL-1360-...yaml` still reads `status: todo` and
`assigned_to: coder`. Those fields are the only thing a promotion decision
consults, and they were never advanced when the parcel moved coder -> cleaner
-> architect a day earlier. So the ticket looked unstarted to the coordinator,
was promoted on the operator's instruction, and was routed to a coder whose
own branch already carried the finished work.

This is the same shape as BL-1371 on 2026-09-03 ("record that the routed
parcel duplicated work already landed on main"), and it is now at least the
second occurrence. The cheap tell that costs one command: before building any
routed ticket, `git log --oneline --all --grep '<BL-id>'` and
`ls backlog/evidence/ | grep '<BL-id>'`. Stage evidence for cleaner and
architect means the parcel is downstream of you, whatever the ticket's status
field says.

## My own error, stated rather than quietly reverted

I did not run that check first. I built a parallel implementation
(`compose_ceremony.sh` + `ceremony_lib.bb` + a unit suite + a property test)
and, in doing so, OVERWROTE the shipped
`specs/pipeline/steps/bl1360CeremonyHandoffComposedSteps.js` with my own
version. Caught it before committing, when the editor reported the file as
"updated" rather than created.

Fully reverted: the handler is restored byte-for-byte from HEAD
(`git checkout HEAD -- <path>`), the suite-manifest row I added is reverted,
and all four files I created are deleted. `git status` is clean of every one
of them, and the checks above were run AFTER that revert, so they measure the
shipped implementation and not mine. Nothing of the prior pass was kept,
altered, or merged with my version — the shipped design is better than what I
wrote (it drives the real entry point over a real fixture and covers the third
ceremony, which mine omitted).

## What actually needs doing, and by whom

Not a coder task. BL-1360's remaining need is bookkeeping and transit, not
implementation:
1. Whoever holds the parcel (last evidence: architect, 2026-09-03) carries it
   through hardener/documenter/QA.
2. The ticket's `status:` needs to reflect reality so it is not promoted a
   third time.

Raised to the coordinator by priority-00 note.

By coder.
