# BL-1005 — architect review: clean sweep, PASS to hardener

**Parcel:** coder `3f5404edb` (derive agent-class-doc-06 build-state claims
from the backlog) + cleaner `0a26231dc` (drop unused `block` param from
`extractBuildStateClaims`'s `record()`), merged into architect at `f54b87c3b`.

**Verdict:** PASS to hardener.

## Review completed (Article 4.4 — full inventory before any verdict)

- **Merge/ancestry sanity:** `git merge-base --is-ancestor 0a26231dc2 HEAD`
  confirmed. Diffed the merge commit against BOTH parents
  (`274ab8207` prior architect tip, `0a26231dc2` cleaner tip): every file
  that differed between the two parents turned out to be a strictly
  monotonic backlog-topic message log or an addition-only config change on
  cleaner's side (`swarmforge/packs/full-forge.conf` coder@sonnet2 seat
  removal) — no architect-side content was dropped by the merge.
- **Dependency-rule hard gate (BL-259):**
  `node extension/out/tools/dependency-gate.js
  specs/pipeline/steps/bl643NonPipelineAgentsSteps.js
  extension/test/bl1005OnboarderBuildStateGate.test.js
  extension/test/bl1005OnboarderGateNonVacuity.property.test.js` →
  **PASSED: no forbidden edges.**
- **Co-change coupling (BL-255):**
  `node extension/out/tools/co-change-report.js` over the same three files.
  One SUSPECTED COUPLING flag: `docs/reference/BL-643-non-pipeline-agents-reference-table.md`
  (3 co-changes with the step file). Judged not a gap: the ticket explicitly
  scopes the reference table, the other seven scenarios, and the BL-684
  rename gate OUT of scope, and this parcel changes only the acceptance-gate
  *mechanics* (how build-state claims are checked), not any documented
  agent behavior the reference table would need to reflect. All other flags
  are the new test files co-changing with each other and with the feature
  file/step file they were authored alongside — expected, not coupling.
- **Declared invariant (BL-633/654):** one invariant declared — "the gate
  never passes vacuously ... reporting zero claims found is a failure,
  never a pass." A property test exists
  (`extension/test/bl1005OnboarderGateNonVacuity.property.test.js`),
  coder-authored (correct ownership per coder.prompt), and is non-vacuous
  by construction: sections are built from typed blocks so the zero-claim
  state and each claim kind are reached deliberately, with asserted
  reachability floors (>=200/200 zero-claim runs; >=60/300 reached for each
  of shipped/unbuilt), and a second property flips one planted claim's
  backlog state per run and asserts the checker fails naming that exact
  ticket id. Ran both new test files live:
  `npx vitest run test/bl1005OnboarderBuildStateGate.test.js --config
  vitest.config.mjs` → 23/23 PASS;
  `npx vitest run test/bl1005OnboarderGateNonVacuity.property.test.js
  --config vitest.properties.config.mjs` → 2/2 PASS.
- **Property Testing pass (architect-owned, undeclared coverage):** the
  touched pure module (`extractBuildStateClaims` /
  `resolveTicketBacklogState` / `checkBuildStateClaims`) is already
  comprehensively property-tested by the coder's non-vacuity test above,
  which doubles as a round-trip/consistency property (plant claims → extract
  → check against a truthful vs. one-flipped resolver). No additional
  property test is warranted — saying so rather than manufacturing a
  vacuous one.
- **Correctness read:** traced `extractBuildStateClaims`'s regex handling
  for shared-state/lastIndex bugs (`SLICE_HEADING_RE.lastIndex = 0` is
  reset before each block's `exec()` loop; `TICKET_ID_RE`/`UNBUILT_MARKER_RE`
  usage via `.match()`/`.test()` needs no such reset); confirmed the
  "not yet shipped" / "not built yet" phrasing is stripped from the block
  before testing the shipped marker, so it reads as unbuilt rather than an
  ambiguous mixed block (covered by its own unit test); confirmed
  `resolveTicketBacklogState`'s dynamic regex (`^${ticketId}[.-]`) cannot
  false-positive on a longer id sharing a numeric prefix (e.g. id `BL-62`
  against file `BL-624-survey.yaml`) — verified both by reading and by the
  existing "never prefix-matches a longer ticket id" test. No correctness
  defect found.
- **Ticket-mandated verification:** ran
  `node specs/pipeline/cli.js
  specs/features/BL-643-non-pipeline-agents-documented-as-a-class.feature`
  live → **18/18 PASS** (was 17 scenarios, now 18 since the outline is a
  two-row Examples table, exactly as the ticket predicted). Confirmed
  `grep -rn "each unshipped phase" specs/` returns nothing — the old
  frozen-snapshot step is fully deleted, not just superseded. Confirmed
  `docs/explanation/BL-643-non-pipeline-agents-as-a-class.md` is untouched
  by this parcel (`git diff 12569ec76..0a26231dc2 --stat -- docs/` is
  empty) — the class document was not edited to satisfy the gate, per the
  ticket's explicit scope constraint.

## Inventory result

**D1..Dn: NONE.** No architecture violation, no invariant violation, no
correctness defect.

Forwarding this commit (this evidence file, committed) to hardener per
Article 4.4 / BL-536 — never the bare received hash.

By architect.
