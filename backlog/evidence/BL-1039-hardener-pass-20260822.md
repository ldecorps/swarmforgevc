# BL-1039 hardener pass — 2026-08-22

**Parcel:** architect-forwarded commit `7ec6565d55` ("architect pass —
clears prior send-back #1, compliant, forwarding to hardener"), merged into
`swarmforge-hardender` cleanly (no conflicts).

## Tooling scope

The guard (`extension/test/helpers/repoCreationGuard.js`) and fixture
(`extension/test/helpers/sharedRepoFixture.js`) are plain JS under
`extension/test/helpers/`, outside both Stryker's scope
(`mutate: ["out/**/*.js"]`, compiled `extension/src` TS only) and CRAP/DRY's
(`crapReport.js`/jscpd, both scoped to `extension/src/**/*.ts`). No
production `extension/src/*.ts` file is touched by this parcel. Per
engineering.prompt's fallback for untooled surfaces: hand-authored surgical
mutation sweep over both files, plus BL-113 Gherkin acceptance mutation for
the feature's `Scenario Outline`.

## BL-113 Gherkin acceptance mutation (soft, all 4 positionals explicit)

    bash specs/pipeline/scripts/run_gherkin_mutation.sh \
      specs/features/BL-1039-unit-tests-share-one-seeded-git-fixture.feature \
      tmp/bl1039-gherkin-mutation \
      specs/pipeline/steps/index.js \
      soft

Result: `outcome: pass`, 2/2 killed (both `Examples:` rows of scenario
"one test's writes are never visible to another" — `declaration` /
`reverse`, the write-order the isolation check runs in). Manifest embedded
in the feature file. No survivors, no errors.

## Hand-authored mutation sweep — `repoCreationGuard.js`

`CREATES_A_REPO` is a 4-way alternation. Each alternative tried in
isolation (removed from the regex, pre-fix source restored byte-identical
between trials via `git diff` empty checks, never mutating while a prior
suite run might still be reading the file):

| alternative | isolated by removal | result |
|---|---|---|
| `['"]git['"]\s*,\s*\[\s*['"]init['"]` (array-arg spawn) | yes | killed — multiple existing tests depend on it |
| `['"]git\s+init\b` (quoted command string) | yes | killed — "a `git init` command STRING creates a repository" |
| `\binit\b[^\n]*--bare` (bare-anywhere-on-line) | yes | **SURVIVED pre-fix** — the existing `"a --bare init creates a repository"` test's fixture (`execFileSync('git', ['init', '--bare'], ...)`) already matches the FIRST alternative regardless of `--bare`, so it never isolated this one; deleting it left all 16 tests green |
| `\bgit\(\s*[^,()]+,\s*\[\s*['"]init['"]` (D1 wrapper-call) | yes | killed — the D1 regression-test block |

Verified the surviving alternative's actual unique job before writing a
fixture for it: its only unique catch is a **template-literal** (backtick)
`` `git init --bare` `` command — the other three alternatives all anchor on
`['"]` and cannot see a backtick-delimited string. Confirmed directly:
`createsRepository('execSync(\`git init --bare\`, ...)')` → `true` with the
alternative present, `false` with it removed.

Added `extension/test/repoCreationGuard.test.js`: "a template-literal `git
init --bare` command creates a repository". Re-injected the same mutant
(alternative removed) after adding the test — now **killed** (1 failing
test, the new one, naming exactly the mutated behaviour). Restored the
source to original; `git diff` on `repoCreationGuard.js` empty.

## `sharedRepoFixture.js` — not re-swept

`sharedRepoFixture.test.js` (8 tests) and
`bl1039SharedRepoFixture.property.test.js` (2 property tests, non-vacuity
documented at authoring time per architect's evidence) already assert every
load-bearing property directly against real git checkouts: seed-once
(`seedCount()` stays 1 across N checkouts), branch pin (`main` regardless of
host `init.defaultBranch`), in-place vs standalone checkout, and isolation
in both writer-first/writer-last orderings with both positive ("writer sees
its own commit") and negative ("no other copy sees it") assertions. No
additional hand-mutation performed here — the logic is thin (one `fs.cpSync`
per caller, one lazy seed guard) and every branch is already exercised by a
real-filesystem assertion, not a mocked one.

## Verification after the fix

- `npx vitest run test/repoCreationGuard.test.js` — **17/17 pass** (was 16,
  +1 new).
- `node specs/pipeline/cli.js specs/features/BL-1039-....feature` —
  **8/8 pass** (unmutated, post-fix confirmation).
- Full default unit lane (`npx vitest run` from `extension/`): **464/465
  files, 8245/8246 tests pass** (up from architect's 8241/8242 by exactly
  +4, matching the one new test's assertions). The one failure —
  `tempDirTrapGuard.test.js` on
  `bl1025_expedite_approval_property_runner.bb` — is the same standing,
  pre-existing BL-1033 defect confirmed on every recent pass this session
  (last-touching commit `71ee902a2`, ancestor of both `main` and
  `origin/main`). Not this parcel's defect.
- No orphaned processes in this worktree. `ps -ef` showed a live
  `vitest --config vitest.properties.config.mjs` run during this pass, but
  its `cwd` (`/proc/<pid>/cwd`) resolved to `.worktrees/QA/extension` for
  every one of its worker PIDs — QA's own concurrent session, not spawned
  by this pass. Nothing left running under `.worktrees/hardender`.

## Verdict

Hardened. One real mutation-uncovered gap closed in the repo-creation
guard's alternation (a template-literal command form the other three
alternatives structurally cannot see); the fixture's isolation logic was
already exhaustively covered by real-filesystem property and unit tests
from the coder/architect passes and needed no further mutation. Forwarding
to documenter.

By hardender.
