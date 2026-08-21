# BL-1006 — architect review: clean sweep, PASS to QA

**Parcel:** coder `baba31319f` (retire BL-982 scenario 06, its two
feature-scoped step handlers, and re-tense the feature narrative), merged
into architect at `cf83870ea`. `required_stages: [coder, architect, qa]` —
cleaner and hardener explicitly skipped by the ticket for stated reasons
(pure deletion, no code added to DRY or to mutate); reviewed and found
consistent with the actual diff (see below).

**Verdict:** PASS to QA (skipping hardender per the ticket's
`required_stages`).

## Review completed (Article 4.4 — full inventory before any verdict)

- **Merge/ancestry sanity:** `git merge-base --is-ancestor baba31319f HEAD`
  confirmed after merge. Diffed the merge commit against BOTH parents
  (`a6ed41619` prior architect tip, `baba31319f` coder tip): both diffs are
  additive only relative to each side's own prior content — no content
  dropped by the merge.
- **Dependency-rule hard gate (BL-259):**
  `node extension/out/tools/dependency-gate.js
  specs/pipeline/steps/bl982SecondSeatSteps.js
  specs/features/BL-982-second-seat-of-a-stage-boots-with-its-own-model.feature`
  → **PASSED: no forbidden edges.**
- **Co-change coupling (BL-255):** ran the same two files through
  `co-change-report.js`. No flag reached the SUSPECTED COUPLING threshold —
  every co-change count is 1-2, below the default frequency-3 gate. Nothing
  to judge.
- **Declared invariants (BL-633/654), two declared, both stated-reason
  (no property test):**
  1. "the retirement deletes an obsolete claim, never a live check..."
  2. "a step handler is deleted only when no scenario still reaches it,
     and handler scoping is read from the registration call..."

  Per BL-654 a declared invariant may leave the parcel as either an
  executable property test or a stated non-encodability reason — never
  silently unencoded. Both take the stated-reason path
  (`backlog/evidence/BL-1006-coder-invariant-encoding-20260821.md`). I did
  not take the reasons on faith:
  - Both invariants quantify over a **one-time deletion decision**, not a
    runtime property of any pure module — there is no code left after the
    deletion to write a generative property against, and a property test
    re-asserting BL-983's contract would itself be the duplication the
    ticket's "retire, never reword" instruction forbids. Legitimate
    non-encodability, not an excuse.
  - The coder recorded that a repo-wide "no scoped registration is
    unreachable from its own feature" property was attempted and abandoned
    — correctly, since (a) the ticket explicitly forbids widening scope to
    a linter/gate here ("if it is worth building, it is worth its own
    ticket") and (b) its own arrival colour on `main` is unmeasured, which
    is exactly the BL-997 trap (a correct gate landing red for reasons
    unrelated to the parcel it rides in on). Declining it was the right
    call, not scope-shirking.
  - The two `stage_skip_reasons` the coordinator relied on (no code added,
    nothing to DRY or mutate) would have been falsified by adding a
    property test here, which the coder noted explicitly — internally
    consistent with the parcel's own scoping.
- **Property Testing pass (architect-owned, undeclared coverage):** no pure
  module was touched — the diff is a scenario/comment deletion plus a
  narrative re-tense in a feature file, and a handler deletion in a step
  file with no surviving logic to cover. No property test is warranted;
  saying so rather than manufacturing one.
- **Correctness read:**
  - Confirmed the deletion is surgical: `git diff` shows exactly scenario
    06, its `# BL-982 ...-06` comment, and the three named handlers
    (`a parcel addressed to that stage is delivered`,
    `the second seat is not delivered the parcel`,
    `the second seat claims nothing`) removed — nothing else.
  - Checked for orphaned imports/helpers after the deletion: `execFileSync`,
    `spawnSync`, `SCRIPTS_DIR`, and `cleanupRoots` are all still referenced
    elsewhere in `bl982SecondSeatSteps.js` (scenario 04's oracle and other
    surviving scenarios) — no dead code left behind.
  - Confirmed the "shared pattern, separate handler" trap the ticket warns
    about: `bl983StageQueueSteps.js` registers its OWN
    `/^a parcel addressed to that stage is delivered$/` via its own
    `defineScoped(…, FEATURE)` — `git diff` against that file is empty, so
    BL-982's deletion did not touch BL-983's copy.
  - Read the re-tensed narrative: no sentence still asserts in the present
    tense that the second seat is inert or claims nothing; it now states
    what the slice did (past tense) and points at BL-983's feature file for
    the live contract.
  - No correctness defect found.
- **Live verification (re-run independently, not trusted from the evidence
  note):**
  - `docs/reference/Specification.MD` — confirmed untouched
    (`git diff --stat` empty), matching the documenter skip reason and
    `qa_e2e_procedure` step 6.
  - `node specs/pipeline/cli.js
    specs/features/BL-982-second-seat-of-a-stage-boots-with-its-own-model.feature`
    → **6/6 PASS, scenario 06 absent from the output** (not passing —
    retired, not reworded, exactly what `qa_e2e_procedure` step 2 demands).
  - `node specs/pipeline/cli.js
    specs/features/BL-983-stage-mailbox-delivers-to-one-idle-seat.feature`
    → **5/5 PASS** — successor coverage (invariant 1) confirmed green, not
    merely present.
  - `npx vitest run --config vitest.config.mjs
    test/socketFixtureShortRootGuard.test.js` → **16/16 PASS** — confirms no
    `os.tmpdir()` root was re-introduced into `bl982SecondSeatSteps.js`
    (BL-948's standing guard, BL-1002's earlier fix not regressed).

## Notes, not send-back items

- `swarmforge/scripts/test/fixtures/` remains untracked in this worktree —
  unrelated to this ticket (Babashka/shell-side fixture system), left
  untouched, as in the prior review.

## Inventory result

**D1..Dn: NONE.** No architecture violation, no invariant violation, no
correctness defect.

Forwarding this commit (this evidence file, committed) to QA per the
ticket's `required_stages` (hardender skipped) and Article 4.4/BL-536 —
never the bare received hash.

By architect.
