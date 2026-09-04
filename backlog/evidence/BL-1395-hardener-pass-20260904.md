# BL-1395 — hardener pass, 2026-09-04

Merged architect commit `453df7cd4f` (COMPLIANT, clean sweep — all three
invariants verified directly in the code, including a careful confirmation
that the banner check short-circuits before any content reliance, and a
live PID-before/after check confirming the `babashka.file` guard actually
works —
`backlog/evidence/BL-1395-architect-20260904.md`). This is the ticket
whose structural fix retires the exact `handoffd.bb` bare-`(-main)` defect
class my own earlier `BL-1392-hardener-critical-fix-handoffd-load-crash-20260904.md`
finding hit.

## Merge conflicts

`extension/test/bl632CommitTimeGuardInvariants.property.test.js` and
`suite-manifest.tsv`. Took HEAD's BL-1398 derived-fixture-set approach
entirely over the architect's hand-listed guard array (including their
new `BB_LOAD_GUARD` constant and hand-added list entry):
`deriveCommitGuardFixtureSet()` walks `run_commit_guards.sh`'s
`run_guard` lines and both git hooks, so it already picks up BL-1395's
`check_bb_scripts_load.sh` automatically via its own required_wiring
anchor (`run_commit_guards.sh:81`) — the hand-added entry was exactly the
class of hand-enumeration BL-1398 exists to retire, and keeping it would
have reintroduced the staleness risk BL-1398 just closed. `suite-manifest.tsv`:
HEAD already had the full union.

Re-verified post-merge before committing: `handoffd.bb` loads clean and
silent (confirms the new guard idiom survived the merge);
`bl632CommitTimeGuardInvariants.property.test.js` 2/2 pass;
`test_bl1395_bb_scripts_load.sh` 9/9 ALL PASS.

## Checks re-run, all independently

- `test_bl1395_bb_scripts_load.sh` — 3 consecutive standalone runs, ALL
  PASS each (matching the architect's own 2x re-run discipline for a
  guard this safety-critical).
- `run_acceptance.sh` on the BL-1395 feature — 10/10 pass.
- `check_feature_handler_registration.sh` — rc 0.
- required_wiring anchors grepped directly at all four sites:
  `run_commit_guards.sh:81` (`run_guard check_bb_scripts_load.sh`),
  `land_step_lib.bb:1169` (the replay tree-guard list entry),
  `handoffd.bb:124/4905` (the `babashka.file` guard definition and its
  use around `(-main)`), `bl1395DaemonBootedBeforePublishSteps.js:79/175`
  (`registerSteps`).

## BL-149 cooldown gate — hand-authored mutation spot-check

`check_bb_scripts_load.sh` — DECISION: run. No shell mutation tool wired
(Startup Tools) — BL-638/BL-567 fallback. Given the architect's evidence
already reasoned carefully about the banner-check ordering, spot-checked
the discriminator regex itself (`analyse_one`'s line 109,
`^-+ Error|Unable to resolve symbol|Could not resolve symbol|Could not
find namespace`) with two mutants rather than trusting the reasoning
alone:

1. Drop `Unable to resolve symbol|Could not resolve symbol|Could not find
   namespace`, keep `^-+ Error` — **SURVIVED**.
2. Drop `^-+ Error`, keep the three specific phrases — **KILLED**
   (`test_bl1395_bb_scripts_load.sh` fails with the forward-reference
   scenario, confirmed via `tail`).

Read together, these prove `^-+ Error` — babashka's own universal
error-banner prefix, present unconditionally on every SCI analysis
failure (`----- Error --------` observed in every real error output this
session, including the `read-json` and forward-reference incidents) — is
the actual load-bearing discriminator for the REFUSAL decision; the three
specific phrases are currently redundant for that decision (though still
used, correctly, by the detail-message extraction at line 113, which the
e2e's own "naming the symbol" assertion exercises via the raw babashka
output, not through this regex). **Accepted as equivalent per the BL-234
class** — demonstrable from the code (babashka's error format is not this
script's to control, and every real error observed this session confirms
the dash-banner prefix is unconditional) rather than assumed. Fragility
noted per BL-927's discipline: if babashka's own error format ever drops
the dash banner, the specific-phrase alternatives become load-bearing —
worth re-checking if that class of survivor ever recurs. Not a defect,
not blocking; recorded here rather than silently accepted.

## BL-113 Gherkin mutation

Three `Scenario Outline`s present. Ran the real mutation pass; confirmed
against the embedded manifest per BL-460 discipline:
`{"index":0,...,"Total":3,"Killed":3}`, `{"index":2,...,"Total":4,"Killed":4}`,
`{"index":4,...,"Total":2,"Killed":2}` — 9/9 killed across all three
scenarios, 0 survived, 0 errors.

## CRAP / DRY

`git show --stat 453df7cd4f` touches no file under `extension/src` — N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes. Hand-mutation backups
removed after use, file diffed byte-identical after each restore.

## Result

Merge resolved by preferring the structurally superior BL-1398 derivation
over a hand-added list entry that would have reintroduced the exact
staleness class BL-1398 just fixed; all four required_wiring anchors and
three declared invariants re-verified independently; a two-mutant spot
check on the core discriminator regex found one accepted-equivalent
survivor, recorded with its reasoning and fragility caveat rather than
silently passed over. Forwarding to documenter.

By hardender.
