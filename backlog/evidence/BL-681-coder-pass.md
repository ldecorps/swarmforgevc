# BL-681 — coder pass

Received `merge_and_process specifier ca45a11f84` (Article 5.3 ratification —
"a consolidation never drops a human sentence" — already committed by the
specifier, including the `specifier.prompt` citation back to it and the
`backlog/paused -> active` rename). Merged that commit into the coder branch
(`git merge --no-edit ca45a11f84`, ancestry confirmed via
`git merge-base --is-ancestor`).

Per BL-233 / this ticket's own notes ("Gherkin parked as `.feature.draft` per
BL-233; the coder promotes it and wires handlers in the same commit"), the
remaining coder work was:

1. Promoted `specs/features/BL-681-consolidation-never-drops-a-human-sentence.feature.draft`
   to a live `.feature` file (`git mv`, no content change).
2. Authored `specs/pipeline/steps/bl681ConsolidationNeverDropsHumanSentenceSteps.js`
   — prose-content step handlers reading the real, already-committed
   `swarmforge/constitution/articles/05_amendments.md` (Article 5.3) and the
   real `swarmforge/roles/specifier.prompt` citation, same pattern as
   `bl680ConsolidationAuthoritySteps.js` / `bl633InvariantsSectionSteps.js`.
   Registered it in `specs/pipeline/steps/index.js`.
3. Ran `specs/pipeline/scripts/run_acceptance.sh
   specs/features/BL-681-consolidation-never-drops-a-human-sentence.feature`:
   all 3 scenarios pass.
4. Non-vacuity check: mutated the article's scenario-01 substring
   ("The clause binds the ACT of consolidating, not any one office." ->
   "The specifier binds the ACT of consolidating.") and re-ran — scenario 01
   failed (1 fail / 2 pass) as expected; reverted (`git diff` on the article
   confirms byte-identical to the merged commit) and re-ran green.

## BL-654 declared-invariant coverage

Ticket declares one invariant: *"The clause names no specific role: it binds
the ACT of consolidating, so it reaches a consolidator the constitution has
not met yet."*

**Stated reason, no property test.** The invariant quantifies over the prose
of one fixed constitutional document (Article 5.3), not over a domain of
generated inputs to a pure module — there is no function here whose behavior
varies across cases for a generator to sweep. The claim ("this clause's
subject is the act, not an office") is a single fact about a single piece of
text, already the exact content the acceptance scenario checks: scenario 01's
second `Then` ("the clause names no specific role as its subject", wired to
`bl681ConsolidationNeverDropsHumanSentenceSteps.js`) asserts the article
contains "The clause binds the ACT of consolidating, not any one office." —
verbatim, real-file, non-vacuity-proven above. Extracting a "pure, testable
module" to property-test over would mean inventing synthetic variants of the
constitution to generate, which tests the step handler's string-matching, not
the invariant. This ticket's own `out_of_scope` excludes building enforcement
tooling for the clause ("This slice states the law; nothing here builds a
checker for it"), which is consistent with there being no module to check —
only the one document, already checked directly.

## Handoff

`git_handoff` to `cleaner`, priority `50`, task `BL-681`.
