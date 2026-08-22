# BL-1015 — architect pass 2, re-fix verification (Article 4.4: NONE)

Reviewed merge `394596be66` (cleaner's D2 fix, on top of coder's D1 fix
`126b913822`) against my own send-back #1 inventory (D1 coder, D2 cleaner;
`backlog/evidence/BL-1015-...-bounce-20260822.md`). Merged first, then read,
then recompiled `extension/out/` before running any tool.

## D1 (coder, git-index gap) — CLEARED, re-verified myself

Read `boyScoutRun/commit.ts` end to end, not just trusted the note. Traced
both repro shapes from my own bounce:

- Tracked file, commit fails: `untrackedAmong` classifies it as already
  tracked, so it is never staged at all — `git commit -- <path>` runs as a
  partial commit through a temporary index that cannot diverge the real one.
  Nothing to unstage on failure because nothing was staged.
- Newly-created file, commit fails: staged via `git add`, then unstaged via
  `git reset --quiet -- <exactly the paths this function staged>` on either a
  failed add or a failed commit — never touches paths the operator staged
  themselves outside this run's own edited paths (scoped deliberately,
  matches the docstring's own reasoning).

Ran `boyScoutRunCommitIndex.test.js` (real temp repos, real refusing
pre-commit hook, asserts `git status --porcelain` both columns): 4/4 pass.
Ran `boyScoutRun.test.js`: 59/59 pass. Ran the property test
(`boyScoutRun.property.test.js`, now with a `commitThrows` generator arm,
reach floor 5 asserted): 1/1 pass — read the assertion myself
(`treesEqual(tree, before)` on the `thrown` branch); the note's own honest
disclosure that this harness proves the working-tree half only (no real git
index in the in-memory mock) and the index half is fixture-level only, is
correct and not a gap — the fixture test above is exactly that.

## D2 (cleaner, boyScoutRun.ts <-> cli.ts acyclic cycle) — CLEARED, re-verified myself

`node extension/out/tools/dependency-gate.js` (full-repo, post-recompile):

    Dependency-rule gate FAILED:
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
      src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"

The `boyScoutRun.ts -> boyScoutRun/cli.ts` edge is gone; only the three
pre-existing BL-759 telegram edges remain (confirmed already tracked there,
not this parcel's scope). Read `boyScoutRun/run.ts` and `boyScoutRun/cli.ts`:
both now depend inward on `./run` for the state machine, the barrel's dynamic
`require('./boyScoutRun/cli')` is a leaf edge with no path back, and `main`
is a thin wrapper (resolve root, run, print) — matches the CLI thin-wrapper
rule.

I had asserted in my own send-back that the barrel's dynamic `require` "does
not participate in the static import graph dependency-cruiser walks" — the
cleaner's evidence correctly disputes this (dependency-cruiser resolves
`require()` the same as static imports; my diagnosis of the MECHANISM was
wrong even though the bounce and its remediation options were right). Noted
for the record, does not change the verdict.

## required_wiring

- Entry 2 (step handler registered): confirmed,
  `specs/pipeline/steps/index.js` still has
  `require('./bl1015BoyScoutRunCleansOneThingSteps')`.
- Entry 1 (`extension/src/tools/boyScoutRun.ts::boyScoutScan`): the
  UNDERLYING requirement is satisfied — `boyScoutRun/run.ts`,
  `boyScoutRun/environment.ts` and `boyScoutRun/types.ts` all import
  `../boyScoutScan` by name, confirmed by direct read, so the run still
  consumes BL-1014's ranking rather than re-deriving one. But the entry's
  cited file, `boyScoutRun.ts`, no longer contains a live import of
  `boyScoutScan` — only doc-comment prose mentioning the name, which
  `pre_qa_gate_lib.bb`'s literal `str/includes?` check cannot distinguish
  from a real wiring. Same shape as BL-1014's own required_wiring drift
  (`backlog/evidence/BL-1014-architect-pass-20260822.md`), same disposition:
  not a bounce (editing `required_wiring` is specifier territory, Article
  1.2) — `note` sent to specifier + coordinator, priority `00`, suggesting
  re-pointing to `extension/src/tools/boyScoutRun/run.ts::boyScoutScan`.

## Re-run of the rest of the suite (not trusted from either evidence file)

- `npm run compile`: clean; confirmed by grepping the moved symbols out of
  compiled `out/` (not exit code alone).
- `npx vitest run` (full unit suite): **471 files / 8355 tests, ALL PASS**.
- `node extension/out/tools/co-change-report.js` on the four core changed
  files: all suspected couplings are the same-module-split siblings
  changing together across this ticket's own commits (frequency 3-4 across
  4 total commits) — expected, not new concerning coupling.
- BL-1015 acceptance: **9/9 PASS**. BL-1066 acceptance (also live on this
  branch from the prior parcel): unaffected, still green.
- `swarmforge/scripts/gherkin_lint_gate.sh` on the feature: parses cleanly.
- `npm run dry` (jscpd): 34 clones, identical count to before this re-fix —
  none in a touched file.

## Verdict

**NONE.** Both send-back #1 items cleared and independently re-verified. One
non-blocking spec-gap note sent (required_wiring #1 anchor drift, priority
00, precedent BL-1014). Forwarding to hardener.

— By architect.
