# BL-895 architect pass — 2026-08-15

## Scope

Received from cleaner as `merge_and_process cleaner af2ca01dc2` (task name
`BL-895-specification-md-duplicated-bl607-paragraph`; the cleaner sent a
second, separate `git_handoff` for BL-768 pointing at the same commit —
correct per Article 2.6, since that commit is the shared tip of a batch
branch satisfying both tickets; reviewed separately, not conflated here).
The merge fast-forwarded (5f1955bf0..af2ca01dc2, no new commit).

Commit in scope for this ticket: `6b0c54784` ("BL-895: remove 285 spurious
BL-607 paragraph duplicates from Specification.MD", by coder). Files
touched: `docs/reference/Specification.MD`,
`specs/pipeline/steps/bl895SpecificationMdBl607DuplicateSteps.js` (new),
`specs/pipeline/steps/index.js` (1-line registration).

## Correctness — diff review (the ticket's own real gate)

`git show 6b0c54784 -- docs/reference/Specification.MD`: 568 lines removed,
0 added. Verified programmatically: 285 removed lines match the BL-607
paragraph prefix exactly, 283 removed lines are blank (`^-$`), and grep for
any OTHER removed-line shape (`^-` excluding those two patterns, excluding
the diff header) returns nothing. 285 + 283 = 568, matching the commit
message exactly. No addition. This is the "pure deletion of exactly the
duplicate paragraphs and their adjacent blank lines" the ticket demands —
confirmed by pattern, not by trusting the byte count.

## QA e2e checks — reproduced live on the merged tree, not taken on trust

1. `grep -c '^\*\*Pipeline role clarifying questions...` → `1`. Pass.
2. Corrupt `--options ''[opt1,opt2]''` variant → `0` occurrences anywhere in
   the file; surviving copy shows `--options '["opt1","opt2"]'`. Pass.
3. `wc -c` → 690,302 bytes (ticket's simulated estimate: 677,981, measured
   against an earlier probe snapshot `0c145b771`). Investigated the ~12KB
   gap per the ticket's own "treat a materially different number as a
   failure to investigate" instruction: `git log --oneline
   0c145b771..6b0c54784^ -- docs/reference/Specification.MD` shows 8
   legitimate documenter commits (BL-689, BL-697, BL-806, BL-765,
   BL-514/894, etc.) landed between the probe and this fix, each adding
   real content to the file — fully accounts for the gap. No commits touch
   the file between `6b0c54784` and current HEAD. Pass, gap explained.
4. Surviving copy's context read directly: line 2897 BL-354 paragraph →
   line 2901 BL-607 paragraph (survivor) → line 2906 BL-708 relay
   paragraph. Matches the ticket notes' stated placement exactly. Pass.
5. `## Out of Scope (v1)` (line 3215): heading followed directly by its 5
   bullets, nothing interleaved. Pass.
6. Diff review: see Correctness section above — every removed line
   accounted for. Pass.

## Acceptance — re-run independently

`node specs/pipeline/cli.js
specs/features/BL-895-specification-md-duplicated-bl607-paragraph.feature`:
4/4 scenarios pass against the real file (not a fixture — the step handler
deliberately reads `docs/reference/Specification.MD` directly, since a copy
would validate a stand-in rather than the artifact the ticket restores).
Read the step handler source
(`bl895SpecificationMdBl607DuplicateSteps.js`): each step performs a real
content check (index count, marker line ordering, heading-adjacency scan,
substring absence) — non-vacuous, not a hardcoded pass.

`npm run compile` (extension/): clean.

## Dependency-rule gate (BL-259, hard gate)

None of this parcel's changed files sit under `extension/src`/`media`, so
per established precedent (BL-826, BL-767, BL-813, BL-823, BL-814, BL-848,
BL-871, BL-877, GH-26 architect passes) ran `node
extension/out/tools/dependency-gate.js` in full-repo mode. Reports the same
pre-existing `acyclic` cycle among `telegram-front-desk-bot.ts` /
`telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts`,
already tracked as BL-759 and reproduced on every architect pass regardless
of parcel content. No import path between any BL-895 file and that cycle.
No violation attributable to this parcel.

(Also spot-checked per-parcel mode against the two changed non-doc files
directly: including `specs/pipeline/steps/index.js` in scope pulls in its
entire ~640-file require graph — by design, it's the acceptance step
registry that requires every step file — and surfaces the identical
pre-existing cycle. Confirms the full-repo-mode reading is the correct one,
not an artifact of scope choice.)

## Co-change coupling (BL-255)

- `bl895SpecificationMdBl607DuplicateSteps.js` co-changes only with
  `docs/reference/Specification.MD` and `specs/pipeline/steps/index.js` (1
  co-change each) — exactly this parcel's own two touched files. Expected,
  no defect.
- `docs/reference/Specification.MD` reports many high-count "SUSPECTED
  COUPLING" entries (`docs/index.md`, architecture diagrams, handoff
  protocol, etc.) — this is the project's living reference doc that nearly
  every documenter pass touches; pre-existing pattern, not introduced or
  worsened by this parcel, which only deletes duplicate content.
- `specs/pipeline/steps/index.js` reports dozens of high-count entries
  (`telegram-front-desk-bot.ts` 68, `handoffd.bb` 59, etc.) — the same
  benign registry pattern already judged in the BL-826 architect pass (a
  file that gets a one-line addition on nearly every feature ships with
  nearly everything).

No coupling defect found.

## Invariants review (BL-654)

`invariants:` is empty on the ticket, explicitly by design (ticket notes
cite BL-633: an absent list is a legitimate outcome for a fixed-artifact
diff-review fix rather than a property over a generated domain). No-op,
correctly not manufactured.

## Property testing pass (architect-owned, engineering.prompt)

No pure, testable module touched. `Specification.MD` is prose; the new step
handler is I/O-driving acceptance glue reading a real file, not a pure
function over a generated domain; `index.js` is a plain registry. No
property-shaped candidate in this parcel — correctly not manufacturing one
to fill the section.

## Architecture boundaries (Article 1 / this role's Owns list)

Docs-only content fix plus acceptance-glue registration. No I/O-boundary,
webview-storage, process-spawn-bypassing-tmux, secrets, or fork-vs-integrate
concern applies — there is no production code in this parcel's diff.

## Verdict

Clean. No architecture violation, no invariant violation, no correctness
defect found. Forwarding to hardener. Article 4.4 explicit-NONE evidence
per the BL-806 review-forward-evidence gate (this commit, not the bare
received hash, is what gets forwarded).

By architect.
