# BL-968 evidence: blind window measurement, offender inventory, guard non-vacuity (2026-08-20, coder)

## Blind window: the acceptance-contract check was blind FROM ITS OWN LANDING

The ticket asks since when the gate has been blind (first landed commit
containing any load-time offender vs the gate's own landing). Measured on
`main` (63 ahead of origin/main at measurement time; local is the fresher
ref, BL-891 check run):

| what | commit | landed (main) |
|---|---|---|
| eager `resolveMainCheckout(__dirname)` in headlessDarkEmitterAuditSteps.js:22 | aed3973ea | 2026-07-13T10:56:44+01:00 |
| eager `resolveMainCheckout(__dirname)` in standingRuleViolationsSteps.js:23 | ac15edd32 | 2026-07-13T11:18:15+01:00 |
| eager `resolveMainCheckout(__dirname)` in routingBreakEvenSteps.js:34 | 3650d060c | 2026-07-13T11:38:43+01:00 |
| eager `readFileSync(...swarm_ensure.bb)` in devHostLauncherSteps.js:26 | 9ce5b13c0 | 2026-07-14T02:27:21+01:00 |
| eager `execFileSync('bash', ['-lc', 'command -v bb'])` (+git) in bl936...Steps.js:28-29 | 709004248 | 2026-08-19T06:15:34+01:00 |
| BL-761 gate + resolver (acceptance_contract_gate_lib.bb, resolve_contract_steps.js) | a5d8039e7 | 2026-08-04T05:22:46+02:00 |

Every one of the four load-FAILURE offenders predates the gate by three
weeks. **The acceptance-contract check therefore never once produced a
real verdict in production: blind from its landing on 2026-08-04 until
this parcel, 2026-08-20 — 16 days, every QA-bound send whose cited commit
contained specs/pipeline (i.e. effectively every send, as the ticket
says).** Each eager binding was verified module-level at its landing
commit (`git show <commit>:<file>`, line numbers above).

## Offender inventory (this parcel fixes all five)

The ticket names three; the standing guard's construction surfaced two
more, both in scope by the ticket's own mechanism (the guard catches what
the resolver cannot load; neither was found by hand-auditing for new
classes):

1-3. The three ticketed `resolveMainCheckout(__dirname)` call sites
   (load-time `git rev-parse` → "fatal: not a git repository" →
   require chain dies → warn-and-skip). Class: git-root resolution.
4. devHostLauncherSteps.js — load-time `readFileSync` of
   `swarmforge/scripts/swarm_ensure.bb`, a live repo file NOT part of the
   materialized tree (only specs/pipeline is mirrored; node_modules and
   extension are symlinked) → ENOENT at load. Class: live-repo-state
   read. Shadowed behind the three git offenders until they were fixed;
   found by the guard's first red run.
5. bl936Bl805PropertyLaneExercisesTheParcelGateSteps.js — TWO load-time
   login-shell spawns (`command -v bb`, `command -v git`). These SUCCEED
   in the materialized tree, so pure loadability never sees them — found
   by this parcel's require-time profiling (~2s of the load) and exactly
   why the guard runs the resolver with a NEUTERED PATH (empty dir):
   require() never consults PATH, so a clean registry is indifferent,
   while any PATH-resolved load-time spawn fails its lookup loudly.
   Class: subprocess at load (invariant 1 bans it whether or not it
   fails).

Residual accepted blind spot, recorded: a load-time subprocess invoked by
ABSOLUTE path with no repo/tree dependency (e.g. `/bin/echo`) still loads
clean under the guard. No offender ever had that shape.

## Registry load cost (measured, for the record)

The green-path resolver run over the materialized current tree measures
~10-35s on this host under swarm load — almost entirely the registry's own
require pass, dominated by bl674EpicDrilldownUiSteps' jsdom require
(~8-11s) and bl538ConsolePausedTicketPagerSteps' bridgeServer require
(~3s). Those are requires — LEGAL load-time work under invariant 1 —
so this parcel deliberately does not touch them (ticket constraint: no
hand-audit beyond the declared classes). Noted as follow-on material: the
live BL-761 gate pays this same require pass on every QA-bound send, and
lazy-requiring jsdom alone would roughly halve it. The new unit-lane guard
file exceeds the 7s per-file budget for the same reason (recorded in the
test header; ~15 files already exceed it, summary lines are the verdict
per the standing lesson).

## Pre-existing sibling reds found while proving behavior-unchanged (NOT this parcel's defects)

Both reproduce from the UNTOUCHED master checkout (no BL-968 edits), so
both predate this parcel; both are live-drift failures of the fixed files'
own features and are surfaced by note to specifier+coordinator alongside
this parcel:

- BL-336 headless-dark-emitter-audit scenario 04: the audit's H1
  re-verification asserts ZERO `"type":"resource` lines in the live
  chaser telemetry (`<main>/.swarmforge/telemetry/chaser-2026-07.jsonl`);
  the live file now has **1022**. The feature fails for anyone running it
  today, eager or lazy.
- BL-337 standing-rule-violation-observable: the lib test runner's
  "KNOWN VIOLATION: BL-252 is a recorded violation of the Scenario-Outline
  rule" check fails (expected 1, actual 0) run from the master checkout's
  own tree. Every BL-337 scenario that gates on the lib suite fails with
  it.

Because of these, this parcel's scenario 04 (behavior-unchanged proof)
executes routingBreakEvenSteps' "that cost is not used" — green today and
a real `mainCheckout()`-at-execution-time consumer — rather than either
red step; the ticket's qa_e2e step 3 ask ("one scenario from each of the
three fixed files") is met for routing via the feature run, and for the
other two the equivalent execution was performed and failed on exactly
the pre-existing assertions above, identically to their pre-parcel
copies.

## Live gate re-check (qa_e2e step 1 shape)

Scenario 03 of this parcel's feature drives the REAL
`gather-acceptance-contract-facts` + `evaluate` pair over a commit minted
from the current tree (temp-index `commit-tree`, no refs moved): registry
loadable, warnings `[]` (no "step registry could not be loaded"),
findings `[]`, unresolved-steps actually consulted — the check's first
real verdict. The pre-fix half of qa_e2e step 1 (same call at the
merge-base reproduces the warning verbatim) remains for QA's independent
run; the specifier already reproduced it against live sends (ticket
description), and the guard's break-and-restore runs below reproduce the
failure mechanism deterministically.

## Guard and property non-vacuity (staged breaks, each restored, run 2026-08-20)

- Unit guard, break 1: eager `resolveMainCheckout` reintroduced in
  standingRuleViolationsSteps → invariant-1 test RED naming
  `standingRuleViolationsSteps.js:28` (`spawnSync git ENOENT`).
- Unit guard, break 2: eager `command -v bb` reintroduced in bl936...Steps
  → invariant-1 test RED naming `bl936...Steps.js:34` (`spawnSync bash
  ENOENT`) — proving the neutered-PATH clause load-bearing: the same
  offender loaded CLEAN in the pre-neutering scan.
- Property lane, break A: helper's naming probe dropped → property RED at
  first draw on "the guard detail must NAME the offender".
- Property lane, break B: helper's PATH neutering dropped → property RED
  on the first benign-subprocess draw with `loadable:true` ("a
  benign-subprocess offender loaded clean") — the strengthened clause and
  that class's generator reach proven together.
