# BL-638 architect review — clean pass, NONE

**Ticket:** BL-638 — Gherkin acceptance mutation reports `Total 0` as a pass for
any feature without a Scenario Outline, and stamps the file so later runs skip it.
**Reviewed commit:** d92ebaf4c7 (received from cleaner via merge_and_process).
**Role:** architect.

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **Dependency-rule gate (BL-259, hard gate).** No file under `extension/src`
   changed in this parcel's diff (9d36c23d20..d92ebaf4c7). `dependency-gate.js`
   scopes to compiled extension output; nothing to check. NO-OP, not skipped.

2. **Co-change / logical coupling (BL-255).** Ran
   `co-change-report.js` against every changed pipeline file. All flagged
   coupling is expected and intentional for this parcel: the wrapper script
   co-changes with `specs/pipeline/steps/index.js` (new step registration) and
   with `hardender.prompt` (the required_wiring pairing this ticket's own
   description mandates). `hardender.prompt`'s coupling with sibling role
   prompts is pre-existing and unrelated to this parcel. No suspicious
   coupling outside what the ticket itself specifies.

3. **Required wiring (both items in the ticket YAML), confirmed present:**
   - `specs/pipeline/scripts/run_gherkin_mutation.sh` no longer `exec`s;
     captures the vendored CLI's `--json` output and pipes it to
     `finalize_gherkin_mutation.js`, which classifies the outcome via
     `gherkinMutationClassify.js` and corrects the feature file via
     `gherkinMutationManifest.js` only when nothing was ever discovered.
   - `swarmforge/roles/hardender.prompt`'s BL-113 bullet no longer ends at
     "skip it, nothing to run" — it now names an actionable fallback (a
     hand-authored surgical mutation sweep, same pattern as
     `expedite_mutation_sweep.sh`) and forbids recording/forwarding an
     inapplicable result as a pass.

4. **Declared invariant** ("A mutation run that generated zero mutants never
   reports a pass and never stamps the feature as covered — for any feature
   shape.") is encoded by
   `extension/test/bl638ZeroMutantNeverReadsAsPass.property.test.js`
   (coder-authored, per BL-654). Both halves covered non-vacuously: half 1
   asserts the zero/nonzero classification boundary directly on both sides
   (never inferred from one generator); half 2 fuzzes manifest shape and
   surrounding feature text and asserts the stamp is always stripped and the
   manifest always marked inapplicable. Confirmed green (3/3) in this
   session's `npm run test:properties` run.

5. **Acceptance** (`specs/features/BL-638-gherkin-mutation-zero-mutants-reads-as-a-pass.feature`):
   ran `run_acceptance.sh` against the real vendored mutator (no fakes). All 7
   scenarios pass genuinely — inapplicable path (01/04/06), re-run stability on
   unchanged text (02), normal Scenario Outline path unchanged (03), hardener
   prompt fallback text (05), and re-arming after adding an outline (07).

6. **Unit tests** for the split pure modules
   (`gherkinMutationClassify.js`/`gherkinMutationManifest.js`/
   `gherkinMutationOutcome.js` barrel) and the `finalize_gherkin_mutation.js`
   thin-CLI wrapper: 25/25 green via `node --test`, including in-process seam
   tests plus spawned wiring tests proving disk reads/writes and the
   unparseable-stdin relay path are load-bearing, not just mocked.

7. **Out-of-scope compliance:** vendored mutator
   (`swarmforge/vendor/aps/`) untouched; no retro-sweep of the 216
   outline-free corpus attempted; stamp mechanism preserved, only corrected
   for the zero-mutant case.

8. **Correctness read:** no defect spotted beyond the above.

## Unrelated observation (not a bounce; reported separately)

The full `npm run test:properties` run (repo-wide, not scoped to this ticket)
showed 6 failures across 3 files unrelated to this parcel's diff —
`bl760DuplicateChainGuard`, `bl787NamedTunnelInvariants`,
`bl797MutationGateProbeCrashFallback` (all already-`done/M8` tickets, all
driving real subprocesses). Host `uptime` showed load averages of 139–161 on a
4-core machine at the time. Reported to the coordinator as a health signal
(Article 3.5), not bounced against BL-638.

## Disposition

PASS. Forwarding to hardener.
