# BL-1015 — architect SEND BACK #1 (2026-08-22)

- **Ticket**: BL-1015 a Boy Scout run cleans one thing, or says why it cleaned nothing
- **Bounced commit**: `61131fa34c` (cleaner's tip; the review covers coder's
  `003870a112` through cleaner's `61131fa34c` — the whole BL-1015 slice)
- **Blamed stage**: coder (earliest of the two blamed stages; inventory travels — Article 4.4)
- **Failure class**: `behavior`
- **Bouncing role**: architect

## Architecture verdict: everything else checked out

- Two-layer boundary, extension-host-owns-IO, no webview storage, no secrets
  in the target repo: N/A — this parcel is pure `extension/src/tools/`
  policy/IO, no webview/VS Code API surface touched.
- `required_wiring` entry 1 (`boyScoutRun` reaches BL-1014's ranking by
  importing `./boyScoutScan` rather than re-deriving one): confirmed —
  `boyScoutRun.ts:57` imports `normalizeSubject` from `./boyScoutScan`, and
  `boyScoutRun/environment.ts` wires `scanRepository` to the real `scan()`.
- `required_wiring` entry 2 (step handler registered): confirmed —
  `specs/pipeline/steps/index.js` gained
  `require('./bl1015BoyScoutRunCleansOneThingSteps')`.
- Co-change report (`co-change-report.js` over all ten changed
  `boyScoutRun*` files): every pairing is frequency 1 — expected for a
  same-commit module split, not evidence of coupling.
- Invariants review (BL-633/654): all three declared invariants have a
  non-vacuous property test (`boyScoutRun.property.test.js`) with reach
  floors for every outcome/reason and a documented break-then-fix pass at
  authoring time. No missing/vacuous property test to bounce for.
- Feature file / step handlers (`bl1015BoyScoutRunCleansOneThingSteps.js`):
  scenario outline validated against a closed `KNOWN_ENVELOPE_ROWS` table,
  drives the REAL `boyScoutRun`/`scan` — no passthrough assertions.

Two defects survive that review, in two different stages' domains. Per
Article 4.4 this is one bounce, both items, routed to the earlier stage.

## D1 — a failed commit leaves the git index partially staged (coder, `behavior`)

**Invariant 1** ("bounded and verified... refused whole — never partially
applied and never committed") is written to cover the working tree, but the
implementation's `restore()` only ever rewrites file *contents* on disk. It
never touches the git *index*. `commitEdits` (`boyScoutRun/commit.ts:34-48`,
originally `boyScoutRun.ts:475+` in the coder's single-file commit
`003870a112`) runs `git add -- <paths>` and only THEN `git commit -- <paths>`.
If the add succeeds and the commit itself fails — a pre-commit hook
rejecting the cleaned code, a disk-full, a GPG-sign failure — `boyScoutRun`'s
catch block calls `restore()` and rethrows (`boyScoutRun.ts:208-214`), but
`restore()` never runs `git reset`/`git restore --staged` on those paths.
The repository is left with the NEW content staged in the index while the
working tree has been reverted to the OLD content — for a path the cleanup
created fresh (snapshot content `null`), `restore()` calls `writeFile(...,
null)`, which `fs.rmSync`s the file while the index still holds it staged as
added. That is a real, on-disk partial application of the commit invariant
was supposed to forbid, even though the RunResult correctly reports
`committed: false`.

**Reproduced** (isolated scratch repo, not this checkout):

```
$ echo old > a.ts && git add a.ts && git commit -qm init
$ echo new > a.ts && git add -- a.ts        # simulates commitEdits' `git add`
$ echo old > a.ts                            # simulates restore() reverting the file
$ git status --porcelain
MM a.ts                                      # staged: old->new, unstaged: new->old
```

and for a file the cleanup created fresh:

```
$ echo "brand new file" > new.ts && git add -- new.ts
$ rm -f new.ts                               # simulates restore()'s writeFile(path, null)
$ git status --porcelain
AD new.ts                                    # Added in index, Deleted in working tree
```

Either state is exactly the ambiguity the ticket's invariant 1 exists to
forbid — the repo is neither "as it was" nor "committed."

**Why the suite doesn't catch it**: no test — unit, property, or step —
ever makes `env.commit` throw at the `boyScoutRun` level.
`extension/test/boyScoutRun.test.js:474` throws from `runGates`, and
`:760` exercises `commitEdits` throwing in isolation (its own `git add`/
`git commit` call), but nothing drives a *thrown commit* through
`boyScoutRun`'s own restore path with a real (or index-aware) spawn to
observe the index divergence. `boyScoutRun.property.test.js`'s `env.commit`
mock (line ~231) never throws, so invariant 1's reach never touches this
branch either — the exact "state a naive generator would essentially never
produce" the property file's own doc comment warns about for other cases.

**Remediation**: `restore()` (or the commit-failure catch block
specifically) must also unstage what `git add` already staged for these
paths on a commit failure — e.g. `git reset -- <paths>` before rewriting
file contents, or restructure `commitEdits` so a failed commit cannot leave
anything staged (a single `git commit` without a prior separate `add` works
for already-tracked paths; only newly-created paths need special handling).
Add a test that makes `env.commit` throw at the `boyScoutRun` level and
asserts the git index (not just file content) is back to its pre-run state
— fixture-level, using a real temp git repo, since the injected mock
environment used by the rest of this suite has no index to diverge.

## D2 — `boyScoutRun.ts` and `boyScoutRun/cli.ts` form an import cycle (cleaner, `behavior`)

**REQUIRED HARD GATE, `node extension/out/tools/dependency-gate.js`**, run
over the parcel's ten changed files:

```
Dependency-rule gate FAILED:
  src/tools/boyScoutRun.ts -> src/tools/boyScoutRun/cli.ts violates "acyclic"
```

Confirmed new (not pre-existing debt): a full-repo scan (`dependency-gate.js`
with no args) shows this edge plus three unrelated, pre-existing
`telegram-front-desk-bot.ts`/`telegramCursorOperator*.ts` cycles that this
parcel does not touch.

The cycle: `boyScoutRun.ts:68` statically re-exports `export { main } from
'./boyScoutRun/cli';`, and `boyScoutRun/cli.ts:8` imports `import {
boyScoutRun } from '../boyScoutRun';` — a two-node cycle. This is new in
this parcel: the coder's single-file commit (`003870a112`) had no
cross-module imports at all (everything lived in one file); the cleaner's
split (`61131fa34c`) introduced both sides of the cycle when it extracted
`cli.ts`. Per Article 4.4/4.3 this item is blamed on the cleaner, the stage
that owns the split — the CLI wrapper's *body* is otherwise fine (thin,
tested at `boyScoutRun.test.js:672`).

Note the file already has a SEPARATE dynamic `require('./boyScoutRun/cli')`
in its `require.main === module` block for the actual CLI entry point,
specifically to keep the module's own mutation-site count about the state
machine — that dynamic require does not participate in the static import
graph dependency-cruiser walks, so it is not what tripped this gate. The
static top-of-file `export { main } from './boyScoutRun/cli'` is what did.

**Remediation** (either shape closes it): move the `boyScoutRun` state
machine itself into its own module under `boyScoutRun/` (mirroring every
other piece of policy this split already pulled out) so `boyScoutRun.ts`
and `boyScoutRun/cli.ts` both import it from a common, non-cyclic home; or
drop the static `export { main } from './boyScoutRun/cli'` re-export from
the top-level barrel (a consumer that wants `main` can already reach it at
`./boyScoutRun/cli` directly, the same path the dynamic require already
uses). Re-run `node extension/out/tools/dependency-gate.js` over the parcel
after either fix and confirm it is the three pre-existing telegram edges
only.
