# BL-1064 architect pass — 2026-08-22

**Parcel:** cleaner-forwarded commit `2313ce379b` ("Merge commit
'6ff52b71e5' into swarmforge-cleaner"), merged into `swarmforge-architect`
(no conflicts; `bl1064LogGroundingSourceSteps` registered correctly in
`specs/pipeline/steps/index.js`).

## Scope note

The merge also carried more BL-1060 in-flight history (its evidence file
gained 51 lines) — incidental shared history, not this pass's concern; that
ticket has not reached architect as its own parcel.

## What this fixes

`bl643NonPipelineAgentsSteps.js`'s log-grounding checker falls back to the
Launcher-column script unless a row declares an explicit override. The Front
Desk row names two log literals — `front-desk-supervisor.log` (written by
`launch_front_desk.sh`) and `front-desk-diagnostics.log` (BL-582's sink,
written by the bot itself, `telegram-front-desk-bot.ts`) — with no override,
so the checker was permanently grounding it against a file that could never
contain the second literal. Both `bl643NonPipelineAgentPaths.property.test.js`
tests failed deterministically on every host, in the DEFAULT property lane —
a permanently red gate, not flakiness (QA's own triage note, split from a
4-ticket batch, correctly separated this from the genuinely load-sensitive
sibling BL-1063).

## Correctness — independently reproduced, not taken on the commit message

- **The two literals genuinely live where the fix says.** `grep -c
  front-desk-diagnostics extension/src/tools/telegram-front-desk-bot.ts` → 1;
  `grep -c front-desk-supervisor swarmforge/scripts/launch_front_desk.sh` →
  4. The new `'Front Desk': [launch_front_desk.sh, telegram-front-desk-bot.ts]`
  override is not a guess.
- **The reference table itself is untouched** — confirmed by reading
  `docs/reference/BL-643-non-pipeline-agents-reference-table.md` directly:
  the Front Desk row still names both literals verbatim. This parcel's diff
  does not touch that file at all (not in the changed-file list), matching
  the ticket's explicit "the table is correct as written, do not delete the
  claim" instruction.
- **The two failure messages are genuinely distinguished, not just
  differently worded.** Read `checkLogGrounding`'s diff in full: a shared
  prefix (so BL-643's own existing assertions keep matching either message),
  then — only for a row whose sources were DERIVED from the Launcher column
  rather than declared — an appended clause naming the derived sources and
  instructing the reader to add a declaration rather than edit the table.
  This directly answers the ticket's own "consider whether the fallback
  should fail loud" prompt with the correct distinction: a declared source
  losing the literal is real drift (table or writer moved); a derived
  source that never could hold it is a missing declaration — conflating the
  two would send a future reader to edit prose that is already correct,
  which is how this defect sat undetected.

## Test suites — all run directly

- `npm run test:properties -- test/bl643NonPipelineAgentPaths.property.test.js
  test/bl1064LogGroundingSource.property.test.js` — **6/6 pass** (2 + 4),
  confirming both previously-failing bl643 tests are now green.
- `bl1064LogGroundingSource.property.test.js` read in full: two enumerated
  checks against the REAL committed table (population = table, no sampling
  needed — correctly not generated) plus two `fast-check`-generated checks
  against the real checker with CONSTRUCTED mixed-literal rows (chosen
  specifically because a uniform independent draw would rarely produce the
  exact "launcher grounds some but not all literals" shape that caused this
  defect) — reach explicitly floored for `mixed`/`allGrounded`/
  `noneGrounded`/`declared`/`derived` (120 + 80 runs). A fourth property
  independently confirms the message-differentiation logic (derived failures
  say so, declared-drift failures do not) across 80 runs, ≥20 of each shape.
  Non-vacuity documented for all three break shapes (drop the override;
  swap the two failure messages; ground on the full literal instead of the
  basename), each mapped to the specific property it would violate.
- Acceptance `BL-1064-...feature` run live via `specs/pipeline/cli.js` —
  **4/4 pass**. `gherkin_lint_gate.sh` — parses cleanly.
- Step handler read in full: asserts its own premise before testing it
  (confirms the launcher genuinely does NOT write the diagnostics literal
  and the declared writer genuinely DOES, so the scenario cannot pass for
  the wrong reason if either file ever changes) — matches the commit
  message's own claim about scenario 01.
- **Sibling-feature regression check**: `BL-643-non-pipeline-agents-documented-as-a-class.feature`
  (the feature this shared step file primarily serves) re-run live —
  **18/18 pass**, no regression from this parcel's edit to the same file.
  Two other consumers of the module (`bl1005OnboarderBuildStateGate.test.js`,
  `bl1005OnboarderGateNonVacuity.property.test.js`) also re-run — clean.

## Dependency-rule gate (BL-259) and co-change (BL-255)

Gate run against all three changed extension-adjacent files: **PASSED, no
forbidden edges.** Co-change: the one flag at the frequency-3 threshold
(`bl643NonPipelineAgentsSteps.js` ↔ its own reference-table doc and
`index.js`) is the file's own well-established, legitimate coupling — it
always changes alongside the table it verifies. Nothing new or suspicious.

## Invariant (declared)

**"Every row whose log literal is written somewhere other than its launcher
declares that writer explicitly; the grounding check never falls back to a
source that cannot contain the literal."** Both halves independently
verified: the real-table enumeration confirms no row currently violates it
(≥4 rows checked, ≥4 rows declared, both floored so a deleted override or a
shrunk table would be caught), and the generated half confirms the checker's
general behavior across constructed row shapes, not just the one row that
happened to trigger this ticket.

## What is NOT the problem — do not change

- The reference table's Front Desk row — correct as written, confirmed
  untouched.
- The three pre-existing overrides (Babysitter, Support, Model Steward) —
  untouched, same shape followed for the new one.
- `bl643NonPipelineAgentPaths.property.test.js`'s own assertions — untouched;
  it now simply passes because its subject is fixed.

## Verdict

COMPLIANT. A correctly-scoped, precedent-following fix that also genuinely
improves the checker's failure-message quality per the ticket's own
follow-up prompt, verified against the real committed table and real source
files rather than a restated map, with rigorous non-vacuous property
coverage specifically targeting the mixed-literal shape that caused the
defect. Forwarding to hardener.

By architect.
