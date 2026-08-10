# BL-869 hardener pass — no defects, one fixture-drift gap closed

**Ticket:** BL-869 — a close commit is validated and credited once per
ticket it closes (fault A: `qa-approved-ticket?` read only the first id a
QA note named; fault B: `parse-close-move` collapsed a multi-ticket
active->done move to its first pair, or unconditionally allowed the whole
close on interleaved path order).
**Reviewed commit:** architect's clean-pass HEAD (cleaner `5117f81ecd` +
architect evidence `9253014b80`), merged into this worktree alongside
BL-798 and QA's BL-800 merge-up.
**Role:** hardender.

## Mutation cooldown gate (BL-149)

Ran `mutation_cooldown_gate.bb` against every changed production file
(`SWARMFORGE_MUTATION_GATE_FORCE_CORES` set — this host has no `nproc`,
per the standing rule_proposal workaround):

- `swarmforge/scripts/pipeline_stage_lib.bb` — **run**
- `swarmforge/scripts/ticket_close_guard_lib.bb` — **run**
- `specs/pipeline/steps/bl869MultiTicketCloseGuardSteps.js` — **run**
- `swarmforge/scripts/commit_integrity_cli.bb` — **skip-cooldown** (recently
  touched, still churning — deferred, not mutation-tested this pass)
- `specs/pipeline/steps/index.js` — **skip-cooldown** (registry file,
  high-frequency, unrelated to this ticket's own logic)

Host load at run time: `uptime` ~5.0-5.9 on 4 cores (~1.3x), under the
2x-cores bypass threshold — proceeded rather than deferring.

## No Stryker/CRAP/DRY — confirmed scope, not assumed

`dependency-gate.js`/the architect's own scope check already confirmed no
`extension/src` or `extension/media` file is touched by this ticket. All
three in-scope production files are `.bb` (Babashka/Clojure — no
mutation/CRAP/DRY tool wired, per engineering.prompt's Startup Tools gap)
plus one spec-harness step-handler `.js` file outside `extension/`'s
Stryker scope (`extension/stryker.config.json` only covers the compiled
extension tree). CRAP/DRY are N/A for the same reason.

## Unit + property test re-run (independent, not just trusted from commit message)

- `bb swarmforge/scripts/test/ticket_close_guard_lib_test_runner.bb` — `ALL PASS`
- `bb swarmforge/scripts/test/pipeline_stage_lib_test_runner.bb` — `ALL TESTS PASSED`
- `bash swarmforge/scripts/test/test_commit_integrity_cli.sh` — `ALL PASS` (7/7)
- `bb swarmforge/scripts/test/bl869_multi_ticket_close_guard_property_runner.bb`
  — 500 pure runs + 60 fs runs, generator coverage both small (179) and
  large (321) closes, `ALL PROPERTIES HOLD`
- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb` — `ALL PASS`
  (BL-798's unchanged production surface, re-verified as part of this
  worktree's same merge)
- `bb swarmforge/scripts/test/bl798_open_slot_escalation_property_runner.bb`
  — 500 runs each, `ALL PROPERTIES HOLD` (BL-798, see below)

## Acceptance re-run (independent)

`run_acceptance.sh specs/features/BL-869-multi-ticket-close-guard.feature`
— all 11 scenarios pass, including the interleaved-path-order case and the
single-ticket first-match regression pin.

## BL-113 soft Gherkin acceptance mutation

`run_gherkin_mutation.sh specs/features/BL-869-multi-ticket-close-guard.feature
... soft` — feature has three `Scenario Outline`s (01, 02, 05); scenarios
03/04 are plain `Scenario`s, correctly not mutated.

**16 mutations total: 10 killed, 6 survived, 0 errors.** Every survivor
verified as an equivalent mutant (BL-234) against the actual code, not
waved through:

- **m8** (`scenarios[0].examples[3].ticket`: `BL-999` -> `BL-9x9`) —
  `qa-approved-ticket?` does a plain `contains?` against the approved set
  `{BL-857,BL-849,BL-840}`; any id outside that set (mutated or not)
  answers `no` identically. Equivalent.
- **m9, m10** (`scenarios[1].examples[*].order`, case-only mutations deep
  in the descriptive text) — `buildClosePaths`'s branch selection is
  `orderText.startsWith('interleaved')`; a mutation that doesn't touch the
  `interleaved` prefix cannot change which branch runs. Equivalent.
- **m12, m14, m16** (`scenarios[4].examples[*].text`, scenario 05's input
  text column) — `extract-ticket-id` uses `re-find` with pattern
  `\b(PREFIX)-?(\d+)\b`, first match only. m12 mutates a substring far from
  the `BL-217` token; m14 corrupts the *second* id in a first-match
  scenario (the id under test, `BL-857`, is untouched); m16 case-mutates
  text with no id-shaped token at all. All three are provably unable to
  change the extracted result given the regex's own semantics. Equivalent.

Verified `scenarios: []` in the feature file's embedded manifest is
EXPECTED here (BL-502: a scenario only enters the manifest with zero
survivors AND zero errors; accepted-equivalent survivors still count as
survivors for that gate) — not evidence the tool failed to run. The run's
own stdout summary (`Total 16 Killed 10 Survived 6 Errors 0`) is the
authoritative signal, read directly from the JSON report rather than
inferred from the manifest.

## Hand-authored mutation sweep — untooled step-handler file (BL-638 fallback)

`specs/pipeline/steps/bl869MultiTicketCloseGuardSteps.js` has no wired
mutation tool (spec-harness JS, outside Stryker's `extension/` scope).
Hand-mutated `buildClosePaths`'s `interleaved` branch to silently emit the
same path order as the `grouped` branch (`[active[0], done[0], active[1],
done[1]]` instead of `[active[0], active[1], done[1], done[0]]`) and
re-ran the full acceptance suite.

**Result: survived — all 11 scenarios stayed green**, even though this
defeats scenario 02's stated purpose ("whatever order the paths arrive
in") and its own comment ("the exact shape that used to defeat
`(first (filter active))`/`(first (filter done))`'s same-id check").

Investigated whether this is a real detection-power gap before treating it
as equivalent, per the hardener's "check the fixture hasn't already
satisfied the condition it claims to prove" duty. Reverted
`parse-close-move` to the pre-fix buggy shape
(`(first (filter active-pred paths))` / same for done, single-map-or-nil)
and ran BOTH the mutated (interleaved-collapsed-to-grouped) and the real
interleaved fixture against it:

- Real interleaved data against the buggy code: `parse-close-move` returns
  `nil` (first active id != first done id) -> `validate-close-allowed`
  reports `{:allowed true}` with no `:ticket-ids` key at all.
- Mutated (grouped-shaped) data against the same buggy code:
  `parse-close-move` returns a single truncated
  `{:ticket-id "BL-857" ...}` -> `{:allowed true :ticket-ids ["BL-857"]}`.

Both flavors fail the SAME assertion in the same scenario
("the close guard reports the closed tickets as ...", a `deepEqual`
against the full expected id list) — `undefined` and `["BL-857"]` both
mismatch `["BL-857", "BL-849"]`. So for the specific historical
regression this scenario documents, the mutation does not currently
create a detection-power gap.

It DOES create a silent drift risk: nothing verified the `interleaved`
branch actually produced first-active/first-done ids that differ, so a
future edit to `buildClosePaths` (unrelated to this ticket) could quietly
degrade scenario 02's second example to duplicate the first while the
scenario's name kept claiming otherwise, indefinitely.

**Fix applied:** added `firstOfState()` and a `assert.notEqual` self-check
in the `interleaved` branch, verifying the constructed paths' first active
and first done ids actually differ before returning them. Re-ran the
original mutation against the patched file — now fails loudly at scenario
02[2] (`AssertionError`) instead of surviving. Restored the file to its
correct (fixed) state afterward; `git diff` confirmed clean before this
change, and the self-check is the only net new code in this file.

Confirmed no regression: full acceptance suite (11/11) and both
`test_commit_integrity_cli.sh` and the property runner still pass with the
self-check in place.

## BL-798 — no new production surface, nothing further for hardener

`chase_sweep_lib.bb` and `handoffd.bb` are byte-for-byte unchanged since
the architect's D1 pass (re-confirmed: `git diff HEAD~1 HEAD --
swarmforge/scripts/chase_sweep_lib.bb swarmforge/scripts/handoffd.bb`
empty in this merged worktree). The only production-adjacent addition is
the property runner itself (test-only). Cooldown-gate run against it is
moot — no production file changed for this ticket in this parcel beyond
the already-reviewed unchanged files and two prose files
(`coordinator.prompt`, `specifier.prompt`), neither of which is
mutation-testable code. Re-ran both the invariant-2 property runner and
`dispatch_gap_test_runner.bb` independently (see above) — both green.
Forwarding architect's commit unchanged for this ticket; no hardening
delta beyond the re-verification above.

## Cleanup

No orphaned `node --test`/`stryker` processes or leaked fixture tmux
servers after this pass (`pgrep`/`pgrep -afl tmux` both clean, scoped to
this worktree). All scratch `tmp/bl869-*` directories removed.

## Handoff

Forwarded to documenter, task names `BL-798-open-slot-nudge-names-candidate-inaction-escalates`
and `BL-869-multi-ticket-close-guard`, same commit (this worktree's HEAD
after this evidence + the self-check fix).
