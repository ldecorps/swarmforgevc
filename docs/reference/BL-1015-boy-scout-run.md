# BL-1015: Boy Scout run — clean one item, or refuse it and say why

The acting half of the `boy-scout` epic. Takes the top-ranked item from
[BL-1014's scan](BL-1014-boy-scout-scan.md), applies an already-written
cleanup proposal for exactly that item inside a declared size envelope, and
commits — or refuses the whole thing and states why. This is slice 2 (act)
of the epic; slice 1 (BL-1014) only ranks and never edits.

**This run does not invent the cleanup.** It bounds and verifies a proposal
someone else already wrote — a person or an agent — at
`.swarmforge/boy-scout/proposal.json`. A generator that invented its own
edits would have no bound on it at all; this half exists to be the bound.

## Run it

1. Write a cleanup proposal for the scan's top-ranked item to
   `.swarmforge/boy-scout/proposal.json`:

   ```json
   {
     "subject": "extension/src/tools/example.ts",
     "summary": "extract the duplicated validation block",
     "edits": [
       { "path": "extension/src/tools/example.ts", "after": "<whole new file content>" },
       { "path": "extension/src/tools/deleteMe.ts", "after": null }
     ]
   }
   ```

   `subject` must be the scan's top-ranked item — anything else is refused.
   Each edit's `after` is the file's whole new content, or `null` to delete
   it; there is no patch/diff format.

2. Run:

   ```sh
   node extension/out/tools/boyScoutRun.js [path-to-root]
   ```

   `path-to-root` defaults to the current working directory. The CLI
   resolves a root, runs, and prints the report to stdout. Exit code 0 means
   the run *completed* — a refusal is a successful run that reported a
   reason — and 1 only when the run itself could not complete (e.g. it
   threw).

3. **Read the report before trusting the commit** — the first live run
   against a real repository should be watched, not trusted blind
   (qa_e2e_procedure step 6).

## The size envelope

`{ files: 3, lines: 120 }` — derived, not invented. BL-634 recorded a
65-insertion median for a normal slice; a Boy Scout cleanup should be
smaller than a normal slice, not larger, so the envelope is roughly twice
that median: generous enough for a real refactor, small enough to stay one
sitting. A proposal at or under both limits is eligible; over either one is
refused whole, never partially applied.

## What the run checks, in order

The order is load-bearing: every check that can refuse or abandon runs
*before* the first write, so a refused or abandoned cleanup leaves the
working tree exactly as it found it.

1. **Nothing ranked** — the scan's inventory is empty → `nothing-ranked`.
2. **No proposal, or an empty one** — `.swarmforge/boy-scout/proposal.json`
   is missing, malformed, or has no edits → `no-cleanup-proposed`.
3. **Wrong item** — the proposal's `subject` is not the scan's top-ranked
   item, *or* one of its edits touches a path belonging to a different
   ranked item (trespass) → refused, `wrong-item`.
4. **Empty diff** — the proposal's edits, applied, change nothing measurable
   → `no-cleanup-proposed`. (Applying, gating, and committing a no-op would
   otherwise report `cleaned` for a run that changed nothing.)
5. **Envelope exceeded** — more than 3 files or 120 changed lines → refused,
   `envelope-exceeded`.
6. **An existing test assertion would change** — invariant 2: a cleanup
   whose only route to green edits an assertion already present in a test
   file is a behaviour change wearing a refactor's clothes → abandoned,
   `assertion-would-change`. The guard is conservative: every assertion line
   present before must still be present after, verbatim, as a multiset,
   across every path this repository tests in (Vitest/`node:assert`,
   Babashka's `assert-true`/`is`, and the shell suite's `assert_*`
   helpers).
7. **The repository's existing gate set** runs on the written result
   (`npm test` in `extension/` — the same gate every pipeline role already
   runs; this ticket adds no gate and weakens none). A failure restores the
   tree from a pre-write snapshot → abandoned, `gate-failed`.
8. **Commit** — exactly the paths this run edited, nothing else (never
   `git add -A`: that would sweep in whatever else was dirty, and would
   commit the proposal file itself since it lives under `.swarmforge/`).
   Only paths git does not already track are staged; a tracked path commits
   through a temporary index so anything else already staged is left alone.
   A failed `git add`/`git commit` unstages what this run staged and
   restores the tree — the run never leaves a partial commit sitting in the
   index. Success → `cleaned`, `committed: true`.

Every one of the six `NoCleanReason` values (`nothing-ranked`,
`no-cleanup-proposed`, `wrong-item`, `envelope-exceeded`,
`assertion-would-change`, `gate-failed`) is reported by name — invariant 3:
a run that cleans nothing always states which reason applied, since a quiet
no-op is otherwise indistinguishable from a clean repository.

## Reading the report

Cleaned:

```
BOY SCOUT RUN — one item, cleaned or refused whole

items ranked: 4
top-ranked item: extension/src/tools/example.ts
proposed cleanup: extract the duplicated validation block

outcome: CLEANED — extension/src/tools/example.ts
  changed 1 file(s), 42 line(s) within an envelope of 3 file(s), 120 line(s)
  gates passed before commit: unit
  files: extension/src/tools/example.ts
  committed: yes
```

Refused (envelope exceeded):

```
BOY SCOUT RUN — one item, cleaned or refused whole

items ranked: 4
top-ranked item: extension/src/tools/example.ts
proposed cleanup: rewrite the whole module

outcome: REFUSED — envelope-exceeded
  the cleanup would change 4 file(s) and 210 line(s), which is bigger than one sitting.
  the envelope is 3 file(s) and 120 line(s); exceeded: files and lines
  nothing was committed; the working tree is unchanged.
```

Every refusal/abandonment line names both the reason and enough detail to
check it by hand (the offending path, which envelope dimension, which gate
failed) — the same checkable-by-hand posture as BL-1014's evidence pointers.

## Boundary: what this slice is not

- **Not a proposal generator.** This run applies and verifies a proposal
  that already exists; it never derives, drafts, or invents one.
- **Not a re-ranker.** Ranking belongs entirely to BL-1014; this slice
  reaches the scan module by name (`../boyScoutScan`) and never computes
  its own ranking, so the two halves can never disagree about what "the
  most annoying debt" is.
- **Never touches more than the top-ranked item**, even if a second item
  would be cheap to include in the same pass.
- **Never widens the envelope to fit an oversized proposal** — refused
  whole instead.
- **Adds no gate, weakens none** — `runGates` runs the repository's
  existing, already-declared commands.

## Source layout

Split along the same policy/IO seam BL-1014's `boyScoutScan.ts` used
(behavior-preserving cleaner pass, not a line-count chop):

- `extension/src/tools/boyScoutRun/types.ts` — shared interfaces, the
  declared envelope, `PROPOSAL_PATH`, `NO_CLEAN_REASONS`
- `extension/src/tools/boyScoutRun/measure.ts` — line/file-count
  measurement and the envelope check (pure)
- `extension/src/tools/boyScoutRun/assertionGuard.ts` — invariant 2's
  per-language assertion-preservation check (pure)
- `extension/src/tools/boyScoutRun/gates.ts` — the declared gate set and
  the spawn that runs it
- `extension/src/tools/boyScoutRun/commit.ts` — commits exactly the edited
  paths, and only them
- `extension/src/tools/boyScoutRun/environment.ts` — the default
  `RunEnvironment`: reads the proposal file, wires real-disk IO and the
  scan
- `extension/src/tools/boyScoutRun/run.ts` — the state machine
  (`boyScoutRun`) described above
- `extension/src/tools/boyScoutRun/report.ts` — the report renderer (pure)
- `extension/src/tools/boyScoutRun/cli.ts` — the CLI entry (`main`)
- `extension/src/tools/boyScoutRun.ts` — the public barrel: re-exports
  everything above and wires `require.main === module` to the CLI

Acceptance feature:
`specs/features/BL-1015-a-boy-scout-run-cleans-one-thing-or-says-why-it-cleaned-nothing.feature`.
