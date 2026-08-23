# BL-1039: Shared Git-Repo Fixture and Its Guard

Unit-lane test files that need a real git repository now take it from one
seeded template instead of running `git init`/`config`/`commit` themselves.
A standing gate scans the test directory and fails on any file that creates
a repository directly without a recorded exemption.

**Last Updated:** 2026-08-22

## Background

Measured 2026-08-22 against the QA worktree's Vitest report: 17 unit-lane
files spawned real `git init` and then built real commits, most once per
scenario — `git init -q`, two `git config` calls, an `--allow-empty`
commit, repeated per test. Together they cost ~165.9s of a 533.8s lane, and
six of them were among the nineteen files breaching BL-378's per-file
7000ms budget, a gate that runs on every `npm test` and folds its exit code
into the run's.

The fix seeds one repository template per process and hands each caller an
independent filesystem copy of it, rather than each test paying the
`init`/`config`/`commit` cost itself.

**Sharing is the whole saving and also the whole risk.** A fixture that
leaked one test's commits into another's view would trade a slow suite for
a lying one, so isolation here is structural, not disciplined: each caller
gets its own directory, copied from the template — two tests cannot see
each other's commits because they are not looking at the same repository.

## How It Works

### The fixture — `extension/test/helpers/sharedRepoFixture.js`

`seedTemplateOnce()` creates the template on first use via
`mkProcessTmpDir` (not the per-test/per-file `mkTmpDir` — the template must
outlive both, seeded once and reused across the whole run) and runs `git
init -q -b main`, two `git config` calls, and one `--allow-empty` commit.
The branch is pinned to `main` explicitly: without `-b main` the template's
branch depends on the host's `init.defaultBranch`, and several callers
assert against `main` directly.

Two ways to consume it:

- `checkoutSeededRepo(prefix, register)` — allocates a fresh directory (via
  `mkTmpDir`) and copies the template into it; `register` lets the caller
  hand the directory to whatever cleanup it already uses.
- `copySeededRepoInto(dir)` — seeds a directory the caller already owns
  (and has already registered for cleanup) in place.

Both use a plain recursive `fs.cpSync`, never `git clone` — cloning would
put a git spawn back into every caller, which is the cost being removed.
`seedCount()` reports how many times the template was actually seeded (used
to assert the seed-once claim); `resetForTest()` is test-only, to observe a
fresh seeding.

### The guard — `extension/test/helpers/repoCreationGuard.js`

`findRepoCreations(testDir)` scans every `*.test.js` file (skipping
`*.property.test.js`, which runs in a separate lane) for a repository
creation call, in any of four shapes: an array-argument spawn
(`execFileSync('git', ['init', ...])`), a quoted command string
(`'git init'`), a `--bare` init anywhere on the line, or a call through a
local `git(dir, ['init', ...])` wrapper function — the dominant shape in
this corpus, and the one a prior architect bounce (D1) had to add: the
guard keys on the literal `git(` call site rather than resolving the
wrapper's binding, so it works regardless of where the wrapper is defined
or imported from.

A line that is wholly a string literal is treated as test data describing
a file's contents, not an executing call, and is stripped before scanning
— the same executing-vs-asserting distinction BL-1032's tmux guard had to
draw. `helpers/sharedRepoFixture.js` and the guard's own test/source files
are excluded by an explicit self-exempt list, since the fixture's whole
job is to create a repository.

### Exemptions

A file that has a real reason to spawn `git init` itself carries a
`// BL-1039-EXEMPT: <reason>` comment. The guard checks the RELATION — a
reason is present and non-empty — not just the marker's existence. Three
files carry a recorded exemption today, each for a repository *shape* the
shared template cannot express:

| File | Shape needed |
| --- | --- |
| `config.test.js` | no git identity configured (BL-443's fallback-identity behavior is the subject under test) |
| `blTopicStore.test.js` | a bare repository, used as a push remote |
| `pilotAcceptanceGateCli.test.js` | no commit / no `main` branch (the empty-repo error paths are the subject) |

Every other call site in each of those files takes its repository from the
shared fixture — the exemption is scoped to the one genuinely different
site, not a blanket file opt-out. An exemption reason must name the
repository shape, never effort, volume, or a later ticket (the same
narrowness BL-1006 established for exemption markers generally).

### Where it is enforced

`extension/test/repoCreationGuard.test.js` runs in the default unit lane
and asserts `findRepoCreations(path.join(__dirname))` is empty against the
real `extension/test` directory — not a fixture string — so the guard is
wired, not merely present. `extension/test/sharedRepoFixture.test.js` and
`extension/test/bl1039SharedRepoFixture.property.test.js` (property lane)
assert the fixture's own contract directly against real git checkouts:
seed-once (`seedCount()` stays 1 across many checkouts), the pinned `main`
branch, and isolation in both writer-first and writer-last orderings.

## Scope: creation, not files

This guard and [BL-1038's sibling guard](BL-1038-pinned-repo-fixture-and-live-derivation-guard.md) classify **operations**, not files. Six
files copy live `swarmforge/scripts/` sources into a fixture (BL-1038's
concern) *and* run `git init` (this guard's) —
`epicReorderBridge.test.js`, `telegramFrontDeskBotCli.test.js`,
`topicMakeTopBridge.test.js`, `epicMakeTopBridge.test.js`,
`pausedPagerBridge.test.js`, and `commitIntegrityRunner.test.js`. Keying on
the creation operation keeps the two guards disjoint by construction; a
guard here that instead keyed on "reads a live path" would collide with
BL-1038's.

The scope was learned the hard way: an earlier version of this ticket
tracked a file list drawn from a cost profile, which undercounted the real
set (14 measured, 17 by operation once `gitHistoryAdapter.test.js`,
`blTopicStore.test.js`, and `costHealthSidecar.test.js` were reclassified,
21 once cheap-but-real creators like `config.test.js` and
`traceHopCli.test.js` were included). The guard's own live scan is the
authority; a number recorded anywhere in the ticket's history is not.

## Human-Facing Surface

None. This closes a cost and a standing-red gate in the unit test lane
itself — no extension command, setting, or UI changes.
