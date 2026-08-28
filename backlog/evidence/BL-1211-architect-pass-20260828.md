# BL-1211 — architect pass, 2026-08-28

Commit reviewed: 829fa47eaf (cleaner, verifying coder work through its
own bounce/re-fix cycle: 6d0df558f original → cleaner D1 bounce → revert
→ e03d4fc34 re-fix).

This is my first review of this feature (the original round was bounced
and reverted by the cleaner before reaching me).

## Architecture
`bounceResurrectionVerdict.ts` (src/quality/, pure, no IO) /
`bounceResurrectionGitAdapter.ts` (src/metrics/, all git IO) — correct
split, same pattern as the BL-1208 sibling (bounceRevertVerdict.ts /
bounceRevertGitAdapter.ts). Dependency gate: PASSED, no forbidden edges.

## The discriminator (amendment's load-bearing distinction)
Verified `isUnauthorizedResurrection` and `findAuthoredBackBy` correctly
implement "byte-identity is the TRIGGER, never the refusal": a match
requires (a) candidate content byte-identical to the bounced content AND
(b) no later same-branch commit whose OWN diff reintroduces that exact
content carries a real pipeline-role "By \<role\>." trailer. Confirmed
`findAuthoredBackBy` does NOT count "any commit touching the path" (the
revert commit itself touches the path but changes content AWAY from
bounced — correctly excluded since its own resulting content won't match
`bouncedContent`). Confirmed `coordinator` is excluded from counting as
authorization both explicitly and structurally (`KNOWN_BOUNCE_ROLES` in
`qaBounce.ts` never included it in the first place — belt-and-suspenders,
not a bug).

## Invariants (all three declared, all encoded and independently verified)
1. Recovery filtering — scenario 01, real git fixtures.
2/3. Lift check refuse/grant + authorship citation — scenarios 02/03/04/05.
- **Scenario 05 (the trickiest, per the ticket's own note) verified with
  a genuine non-vacuity check**: the positive case (coder-authored verbatim
  reinstatement) grants and cites the exact commit+role; the negative
  control (coordinator-authored, otherwise identical) refuses — proving
  the discriminator is actually authorship, not disguised byte-comparison.
- **qa_e2e_procedure step 7 (causality, not luck) is genuinely tested**:
  `filtering the recovery is what makes the lift check pass, not
  independent luck` builds ONE fixture, shows the filtered-recovery
  version lifts, then applies the UNFILTERED restore to the SAME branch
  and shows it now refuses — this is causal proof, not two independent
  assertions that happen to agree.

## D1 (cleaner's bounce) — reconfirmed fixed
Re-ran `bounceResurrection.test.js` 10 consecutive times: 12/12 pass every
time (the flaky scenario 05 non-vacuity check, previously failing ~3/8
loops on cross-repo SHA reuse, is now stable — each fixture builds its
own bounced-then-reverted pair). `quarantineLiftCheck` fails CLOSED on an
unresolvable bounce record; `filterRecoveryPaths` still fails OPEN
(matching this repo's own send-time-gate convention) — confirmed by the
dedicated contrast test.

## Verification run
- `npm run compile`: clean.
- `bounceResurrection.test.js`: 12/12 pass, stable across 10 runs.
- BL-1211 acceptance feature: 5/5 pass, stable across 3 runs.
- Dependency gate: PASSED.

## Scope observation (note filed, not a bounce — see below)
Unlike BL-1201/1202/1215/1196 this ticket declares no `required_wiring`
entry, and `quarantineLiftCheck`/`filterRecoveryPaths` are not called from
anywhere else in the codebase yet — no CLI, no automated gate. This is
architecturally different from the BL-1201 defect I bounced earlier
today: there the underlying LOGIC was provably broken even if wired
correctly (the capture flow destroyed its own precondition). Here the
logic is correct, tested with real git fixtures, and would work
correctly the moment something calls it — the open question is scope
(the approval_context's own "folding it into the gate is what makes it
not-optional" language), not correctness. That is a call for the
specifier, not something I can resolve by inspection, so I am not
bouncing over it — filed as a note instead.

NONE outstanding for correctness. Forwarding to hardener.

By architect.
