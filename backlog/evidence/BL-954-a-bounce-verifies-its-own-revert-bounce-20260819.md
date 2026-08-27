# BL-954 architect bounce — 2026-08-19

Reviewed commit: `9ff346f85f` (cleaner's split of `bounceRevertCheck.ts` /
`bounceRevertVerdict.ts`, on top of the coder's `c617b0244` implementation).
Merged into `swarmforge-architect` at `9bd2c0782`, reverted at the commit
immediately following this evidence file's commit.

Complete review inventory (Article 4.4 — one bounce, every defect found this
pass). All three items below block the parcel; nothing else in the review
checklist (co-change coupling, wiring reachability, invariant-3 recording
order, existing unit/property suites) turned up an issue.

## D1 — Hard-gate violation: `src/quality/` importing `child_process`

`extension/src/quality/bounceRevertCheck.ts` imports `child_process`
(`execFileSync`) and lives under `src/quality/`, which `.dependency-cruiser.cjs`
defines as POLICY — "the one directory in this repo that is genuinely pure
decision/analysis code today" — with an explicit forbidden edge:

```
node extension/out/tools/dependency-gate.js src/quality/bounceRevertCheck.ts \
  src/quality/bounceRevertVerdict.ts src/tools/record-bounce.ts
```
```
Dependency-rule gate FAILED:
  src/quality/bounceRevertCheck.ts -> child_process violates "no-io-from-policy"
```

This is the REQUIRED HARD GATE (BL-259): any reported forbidden edge blocks
the parcel. The cleaner's split correctly separated the pure decision
(`bounceRevertVerdict.ts`, confirmed zero IO imports, gate passes on it
alone) from the git-IO adapter — but left the adapter (`execGitReader`,
`gatherBounceRevertFacts`, the composed `bounceRevertCheck` function) in the
same `src/quality/` directory the ruleset reserves for pure code, so the
violation the coder introduced survives the split unchanged.

**Established fix pattern already in this codebase**: the analogous
`coChange`/`gitHistoryAdapter` split. `src/quality/coChange.ts` is pure (only
imports the `GitLogEntry` type); the git-IO adapter that gathers real repo
data lives in `src/metrics/gitHistoryAdapter.ts` — confirmed the gate passes
on that file today even though it imports `child_process`, because it is
outside `src/quality/`. Move `bounceRevertCheck.ts`'s IO-performing pieces
(the `GitReader` type, `execGitReader`, `gatherBounceRevertFacts`, and the
composed `bounceRevertCheck()` entry point) out of `src/quality/` into
`src/metrics/` (or wherever this project's other git-IO adapters for
quality/analysis checks live), leaving only the pure verdict
(`bounceRevertVerdict.ts`) under `quality/`. Update `record-bounce.ts`'s
import path to match. Re-run the dependency gate on the moved files before
forwarding again.

## D2 — `gatherBounceRevertFacts` is blind to merge-commit bounces, silently reading them as 'clean'

`gatherBounceRevertFacts` (`bounceRevertCheck.ts`) computes touched files via:

```ts
const touched = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', opts.commit])
```

`git diff-tree` with no `-m`/`-c`/`--first-parent` produces **empty output**
for a merge commit — reproduced directly against this repo's own history:

```
$ git diff-tree --no-commit-id --name-only -r 428cd6a46   # a real merge commit
(empty)
$ git diff-tree --no-commit-id --name-only -r -m --first-parent 428cd6a46
backlog/active/BL-685-stranded-resident-detection.yaml
...
```

When `touched` is empty, `files` is `[]`, `liveFiles` is `[]`, and
`decideBounceRevertVerdict` returns `'clean'` — regardless of whether the
bounced content was actually reverted. This is not a hypothetical edge case:
the `commit:` field a role names when it bounces (and the commit
`record-bounce.js --commit` is invoked with) is routinely a MERGE commit in
this repo's actual practice — e.g. `acc8e7fae` (this worktree's own most
recent architect pass-forward) has two parents and carries its own tree
diff, exactly the shape a bounced commit can take. A bounce naming a
merge-commit as `--commit` would silently report `'clean'` no matter what
state the bouncing branch is actually in — the exact failure class BL-954
exists to close (BL-935's silent-clean, now reproduced one layer down in the
fix itself), and in tension with invariant 3's "never silently read as
clean."

Neither the unit test (`bounceRevertCheck.test.js`, real git repo, only ever
commits the bounced change as a single-parent commit) nor the property
test's `fakeGit` (hard-codes the exact same non-`-m` `diff-tree` invocation
the implementation uses, so it can't disagree with it) exercises this path —
confirmed by reading both fixtures; neither constructs a merge commit as the
bounced commit.

**Fix**: gather touched files with `-m --first-parent` (matching this
codebase's own standing lesson on `diff-tree`/`show --name-only` blindness
to merge commits), or explicitly detect a multi-parent commit and diff
against first-parent. Add a Scenario/property case where the bounced commit
is itself a merge commit with real tree changes, in both the reverted and
unreverted states, and confirm it reports `violation`/`clean` correctly
rather than defaulting to `clean` via an empty file list.

## D3 — `ancestorOfMain` reads only the local `main` ref, not `origin/main`

```ts
const ancestorOfMain = runGit(['merge-base', '--is-ancestor', opts.commit, 'main']).status === 0;
```

Per this project's own standing workflow rule ("A Prior QA Bounce Is Not In
Your Worktree — Check It Against `main`"): local `main` and `origin/main` can
diverge in either direction across worktrees — QA can only push `HEAD:main`
from `.worktrees/QA`, which advances `origin/main` without fast-forwarding
any other worktree's local `main` ref, while the master checkout adds its own
bookkeeping commits on top. Measured precedent (BL-891, 2026-08-14): the two
refs were 8 ahead / 22 behind in one snapshot. Right now, in this worktree,
local `main` happens to be 46 ahead / 0 behind `origin/main` — not currently
triggering — but that is a timing accident, not a guarantee, and is exactly
the shape of gap the standing rule exists to close ("Read BOTH `main` and
`origin/main` — either can be the stale one").

If local `main` in the bouncing role's worktree ever lags `origin/main`, a
commit that is genuinely already published (an ancestor of `origin/main`)
would compute `ancestorOfMain: false` here, and the check would emit
`verdict: 'violation'` with a `git revert` remedy for content that is already
on the published branch — precisely what invariant 2 forbids ("the
already-on-main exception never produces a revert instruction... the check
must never push a role toward reverting published history").

**Fix**: treat a commit as already-on-main if it is an ancestor of either
`main` or `origin/main` (fetch is not required to be triggered by the check
itself — reading whichever ref the worktree already has is consistent with
how this codebase's own workflow rule frames it: "read the one that is
ahead"). Add a fixture/property case exercising a stale local `main`
scenario.

## Verification run this pass

- `npm run compile` (extension) — clean.
- `node out/tools/dependency-gate.js` on the three changed source files — D1
  above.
- `node out/tools/co-change-report.js` on the same files — only pre-existing,
  long-standing coupling for `record-bounce.ts` (its BL-635/BL-689 history);
  nothing attributable to this parcel's diff.
- `npx vitest run test/bounceRevertCheck.test.js test/recordBounceCli.test.js`
  — 71/71 pass (expected; neither D2 nor D3 is covered by the existing
  suite).
- `npx vitest run --config vitest.properties.config.mjs bl954` — 3/3 pass
  (same reason).
- Invariant review: invariant 3 (recording never contingent on the check) —
  confirmed compliant by reading `record-bounce.ts` (the durable record write
  happens strictly before `runBounceRevertCheck`, and a thrown check is
  caught and mapped to `undeterminable`). Invariants 1 and 2 are each
  undermined by D2 and D3 respectively under real operating conditions, even
  though the existing test suite (which does not construct those conditions)
  stays green.
- `required_wiring` (record-bounce.ts calling the real check): confirmed —
  `bl954BounceRevertVerifiedSteps.js` drives the compiled CLI as a subprocess
  over a fixture repo, not a reimplementation.

By architect.
