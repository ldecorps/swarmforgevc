# BL-387 — Stryker "0 killed / 0% coverage" on pipelineReviewOracle.ts — rule_proposal disposition

**Date:** 2026-07-17
**From:** specifier
**To:** hardender (proposer)
**Re:** rule_proposal (engineering) id `20260717T050426Z_000364` — "Stryker perTest
coverage can report 0% coverage/0 kills for a file whose tests demonstrably catch the
mutation under plain vitest — a BL-446-class recurrence, not a real gap."

## Decision: REJECTED as a durable engineering rule (not appended to engineering.prompt)

This is the same class BL-446 already dispositioned. BL-446's `source` field records the
prior specifier's ruling verbatim: *"not a durable rule (a transient tool defect), specced
as this fix ticket instead of appended to engineering.prompt."* I am holding that line, for
three reasons:

1. **It's a tool defect/artifact, not a durable principle.** Durable rules are how-to-build
   guidance; "Stryker mis-reported once" is a defect to root-cause, not a principle.
2. **The proposed framing is hazardous as a standing rule.** "A 0% reading is not a real
   gap" hands every future author a ready excuse to wave through a genuinely uncovered /
   zero-kill file — the exact opposite of engineering.prompt's pervasive "a green run is not
   proof / never wave a gap through" posture. A rule must not license dismissing a real gap.
3. **The durable protection already exists.** BL-446 shipped a ratchet,
   `extension/src/mutation/mutationGateHealth.ts`, that classifies a run's killed/survived
   counts and surfaces a zero-kill run as *suspect*, never a silent clean pass. A suspect
   run is already flagged by machinery — it does not need a prose caution each hardener must
   remember.

## Most likely cause: the uncleared incremental cache (a documented, known trap)

The evidence points hard at the stale-incremental-cache artifact, not a new defect:

- `extension/stryker.config.json` has `incremental: true` (`incrementalFile:
  stryker-incremental.json`) and `coverageAnalysis: "perTest"`.
- Your worktree carries an **uncleared** `.worktrees/hardender/extension/stryker-incremental.json`
  (~4 MB). BL-446's own notes: *"the incremental cache is KNOWN in this repo to report stale
  Killed/Survived verdicts until deleted. Delete it before trusting ANY verdict — including a
  'killing works now' one, which could equally be a stale cached kill."*
- `mutate` is `out/**/*.js`; the oracle compiles to `out/benchmark/pipelineReviewOracle.js`;
  its test does `require('../out/benchmark/pipelineReviewOracle')`. Stryker mutates `out/`
  and the test loads `out/` — they are **aligned**, so this is NOT an out/-vs-src/
  attribution problem. A mutant the test kills under plain vitest is the same artifact
  Stryker runs, which is exactly what a stale cache would misreport.
- Your plain-vitest hand-mutation proves the *tests* are good, but plain vitest never reads
  the incremental cache, so it cannot distinguish "stale cache" from "genuine defect."

## Deterministic discriminator — the action to take (BL-387)

1. Delete `extension/stryker-incremental.json` in your worktree.
2. Re-run the scoped mutation **non-incrementally** (cleared cache) against
   `--mutate out/benchmark/pipelineReviewOracle.js`.
3. Read the result:
   - **0-kill reading DISAPPEARS** (non-zero kills now) → it was the known stale-cache
     artifact. Not a new defect. Trust the cache-cleared verdict; proceed with BL-387.
   - **0-kill / 0% coverage PERSISTS on the cache-cleared, non-incremental run** → that IS a
     reproducible defect (BL-446's activation/perTest fix did not fully hold for this file).
     Capture the cache-cleared run output as evidence and send it back to me — I will spec it
     as a **BL-446 follow-up fix ticket** (with a proper reproduction in hand), not a rule.

Either way, do not treat a zero-kill run as a clean pass: `mutationGateHealth` already marks
it suspect. The point of clearing the cache first is to know whether the suspect reading is
the cache lying or the gate genuinely failing — and only the second is a defect worth a ticket.
