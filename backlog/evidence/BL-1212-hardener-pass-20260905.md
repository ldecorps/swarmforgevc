# BL-1212 — hardener pass, 2026-09-05

Ticket: BL-1212-real-tree-docs-gate-never-recorded-its-live-read-exemption
Commit reviewed: bd9ca1968e (architect, replayed the specifier's in-flight
amendment retiring scenario 02)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `npx vitest run test/liveRepoDerivationGuard.test.js test/docsStructureRealTree.test.js` | 24/24 pass (19+5) |
| `node specs/pipeline/cli.js specs/features/BL-1212-...feature` | 2/2 pass — scenario 02 correctly retired, no dangling step reference |
| `npm run compile` | clean |
| `git diff --name-only bd9ca1968e^ bd9ca1968e` | `backlog/evidence/BL-1212-architect-pass-20260905.md`, `specs/pipeline/steps/bl1212RealTreeDocsGateRecordsItsLiveReadExemptionSteps.js` only — matches the architect's own claimed scope for the amendment replay |
| `grep -n "BL-1038-EXEMPT" extension/test/docsStructureRealTree.test.js` | present, reason states "the live read is the assertion" in the file's own terms, matching the ticket's ask (mirrors `pricingTable.test.js`'s phrasing) |
| step handler's `exemptionReason`/`findLiveRepoDerivations` | both confirmed as real exports of `extension/test/helpers/liveRepoDerivationGuard.js` (lines 178, 208) — the acceptance drives the real guard helper, not a reimplementation |
| Feature file scenario 02 | confirmed RETIRED (not reworded), commented out with a RETIRE-WITH: BL-1435 pointer and a dated rationale, per Article 5.3/BL-1006 |
| Step handler's own steps | no unreachable/dangling scenario-02 step definitions remain (confirmed by reading the file directly — the header documents the retirement, the steps below it are only scenarios 01 and 03) |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean — no vitest/node --test/stryker process traced to this worktree |

## Constraints respected (re-confirmed independently)

- `pilotMkdtempConventionCheck.test.js` untouched (`git diff` confirms; BL-1209 already landed and owns that file's own fix).
- `extension/test/helpers/liveRepoDerivationGuard.js` (the guard itself) untouched — confirmed via `git diff --name-only` across the full parcel history (coder → cleaner → architect → this pass): only the target test file's comment, the feature file, and the step-handler file are touched.
- `docsStructureRealTree.test.js`'s real-tree assertions and its fixture-based non-vacuity case are unchanged — only the one exemption comment block was added.
- No other exemption added — grepped for `BL-1038-EXEMPT` repo-wide; count matches the pre-existing ten plus this one new occurrence.

## BL-113 gherkin mutation: not applicable

`grep -c "Scenario Outline" specs/features/BL-1212-...feature` → 0. The
feature carries two plain `Scenario:` blocks (01, 03) and one retired
scenario (02, commented out, no runnable Examples). BL-113 mutation
testing targets `Scenario Outline` Examples cells specifically and has no
target here (this is the "no Scenario Outline anywhere" case, distinct
from BL-638's `inapplicable`-exit-2 case, which is for a feature that
still *contains* an Outline with zero mutable cells).

**Hand-authored fallback considered and correctly not forced.** This
parcel's own diff is a single non-executable code comment (the
`BL-1038-EXEMPT:` block) — comment text cannot be hand-mutated
meaningfully, because no test observes comment content directly except
via the guard's own `exemptionReason()` regex match on the word "reason"
being present, which is already exercised by the pre-existing, unmodified
`liveRepoDerivationGuard.test.js` suite (its own "an exemption with a
recorded reason is honoured" / "a BARE exemption marker with no reason is
NOT honoured" tests, 19/19 green, unmodified by this ticket). This
matches this session's established "stated-reason invariant, no new
executable surface, no meaningful randomizable input domain" pattern
(BL-1290/BL-1221/BL-1263's own precedent), independently re-confirmed
here by reading the diff rather than trusted from the coder's claim.

## Design/CRAP/DRY

No production code changed by this parcel (test-comment-only). No new
duplication introduced.

## Verdict

No defect. The specifier's in-flight amendment (retiring scenario 02,
minting BL-1435) was correctly replayed by the architect and is confirmed
clean and complete. Forwarding to documenter.
