# BL-951 — architect review: PASS

Reviewed commit: `3bc4fc43ed` (cleaner), carrying `b2ec618e73` (coder's fix)
and the cleaner's verification.

Verdict: **PASS — forward to hardender.** No architecture violation, no
correctness defect, all three declared invariants hold with non-vacuous
verification performed independently in this worktree (not just re-read
from the commit message).

## Change reviewed

`route-required-stages` (`swarmforge/scripts/swarm_handoff.bb`) previously
returned before any skip recording whenever `resolve-effective` resolved to
`:default-full` (declaration absent, unparseable, present-but-invalid, or
the sender's worktree had no active ticket content at all — the
BL-317/BL-325 staleness window). That made the conservative default the one
case with no audit trail. The fix separates the RECORD (derived purely from
`hop-skipped-stages sender delivered`, needing no declaration) from the
REWRITE decision (still gated on a usable declaration), and carries
`resolve-effective`'s own `:rejected?`/`:rejection-reason` onto the record
and into the envelope header when a present declaration is invalid.

## Module boundaries / dependency direction

No `extension/` files touched — this parcel is entirely Babashka
(`swarmforge/scripts/swarm_handoff.bb`, a new test runner) plus a JS step
handler under `specs/pipeline/steps/`. `node extension/out/tools/dependency-gate.js`
scopes to `extension/src`+`media` by design (confirmed by reading its own
usage doc and by running it against this parcel's files, which correctly
errors "can't open" — they are outside its domain). The BL-259 hard gate is
therefore **not applicable** to this parcel; nothing was eyeballed in its
place, the inapplicability itself was verified rather than assumed.

Co-change report (`node extension/out/tools/co-change-report.js` against all
4 changed files) flags `required_stages_lib.bb` and `handoffd.bb` at 6
co-changes (SUSPECTED COUPLING, informational only). Checked: the fix reads
only pre-existing `required_stages_lib.bb` public keys (`:rejected?`,
`:rejection-reason`, `resolve-effective`, `hop-skipped-stages`) — grepped and
confirmed all four are already exposed with the exact contract the fix
relies on (lines 205-250, 317-331 of `required_stages_lib.bb`), so the
library needed no change. The flagged coupling is `swarm_handoff.bb` being a
central hub file (expected — the co-change tool's own top pairs for this
file always include the handoff-protocol/routing family) and is not a
diagnostic signal of anything wrong with this parcel.

## Invariants review (BL-633/BL-654)

Ticket declares 3 invariants. All 3 checked as a distinct pass, separate
from the architecture read above:

1. **"Absence of a declaration is never quieter than presence of one."**
   Executable property test: acceptance Scenario Outline 01 (3 examples:
   absent/invalid/full-chain, all asserting the identical 4-stage skip) AND
   `bl951_stage_skip_recording_property_runner.bb`'s "invariant 1" checks
   (12 sampled real hops via the actual `swarm_handoff.bb` send path).
   Verified non-vacuous **myself**, not by trusting the commit message: with
   `swarm_handoff.bb` reverted to the pre-fix (`d58777ed5`) version in this
   worktree, the acceptance suite drops from 7/7 to 4/7 (exactly scenarios
   01[2] `invalid`, 01 rejection-reason [03], and the two absent/invalid
   full-chain-comparison cases fail — full-chain still passes), and the
   property runner produces 41 failures. Restored the fix afterward; `git
   status` confirms a byte-identical, clean tree.
2. **"Recording a skip never changes delivery."** Acceptance scenario 04
   ("delivered to QA and to no other role") plus property runner invariant
   2 (delivery unchanged across all 3 declaration states, every sampled
   hop). Same non-vacuity run above exercises this invariant's test too.
3. **"The envelope header and the routing-skips log line never disagree."**
   NOT encoded as a property test — the runner's own header states why:
   both artifacts derive from the ONE `:routing-skipped` map computed once
   in `-main` (line 673) and passed to both `write-handoff!` (stamps the
   header, gated on the same value) and `log-routing-skip!` (appends the
   jsonl line, gated the same way) — I independently confirmed there is
   exactly one call site of `route-required-stages` in the whole file
   (`grep -n` for the four related symbols), so the claim is structurally
   guaranteed rather than needing a fault-injection test. This is a stated,
   verified non-encodability reason, not an omission. The acceptance suite
   asserts both artifacts together on every scenario instead (invariant 3's
   requirement satisfied at the acceptance layer).

No violation found on any of the three. No missing/vacuous property test.

## Verification run in this worktree at the merged commit

| Check | Result |
|---|---|
| `./specs/pipeline/scripts/run_acceptance.sh specs/features/BL-951-...feature` | 7/7 PASS |
| Non-vacuity: same suite against pre-fix `swarm_handoff.bb` | 4/7 PASS, 3 FAIL (as expected, then fix restored) |
| `bb swarmforge/scripts/test/bl951_stage_skip_recording_property_runner.bb` | PASS (12 sampled hops) |
| Non-vacuity: same runner against pre-fix `swarm_handoff.bb` | 41 failures (then fix restored) |
| `bb swarmforge/scripts/test/required_stages_test_runner.bb` | ALL PASS (no regression) |
| `bash swarmforge/scripts/test/test_redo_from.sh` | ALL PASS (no regression) |
| `bash swarmforge/scripts/test/test_reroute.sh` | ALL PASS (no regression) |
| `specs/pipeline/steps/index.js` registration (`required_wiring`) | confirmed present; acceptance run proves the handler is wired (no runtime throw) |
| `node extension/out/tools/dependency-gate.js` | not applicable — no `extension/` files in this parcel |
| `node extension/out/tools/co-change-report.js` (4 changed files) | informational; hub-file coupling only, checked against the library contract, no action needed |

## Property testing (new/undeclared properties)

Not applicable beyond the above. The only pure-shaped logic touched is
Babashka (`route-required-stages`, `format-routing-skipped`), already
covered by the ticket's own declared-invariant property runner
(BL-654/BL-951). No JS/TS pure module under `extension/src` was touched.

By architect.
