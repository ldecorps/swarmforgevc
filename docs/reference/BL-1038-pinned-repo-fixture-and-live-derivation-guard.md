# BL-1038: Pinned-Repo Fixture and the Live-Derivation Guard

Unit-lane test files that used to derive their fixtures from the live
SwarmForge repository — walking real git history, or copying the whole
live `swarmforge/scripts/` directory — now read from a fixture whose
contents do not grow as the repository does. A standing gate scans the
test directory and fails on any file whose cost is a function of the live
repository's size or history, unless the file records why it must be.

**Last Updated:** 2026-09-02

## Background

Measured 2026-08-22 against the QA worktree's Vitest report: seven
unit-lane files took the live repository as their subject, at ~121.6s of
the lane's 533.8s. Unlike a fixed per-scenario cost, this family gets
slower on its own, with no test added and no code changed, because the
thing it measures — the repository — grows every day. That is why this
surface absorbed four measured per-file-budget raises in four days
(BL-815, BL-914, BL-969, BL-999) with a fifth queued: each raise was
correct when measured and stale within days. This ticket removes the
reason the number moves, rather than repricing it again.

**The family is defined by the operation, not by a file list.** This
ticket owns a *read whose subject is the live repository*; its sibling
BL-1039 (see [its own reference doc](BL-1039-shared-git-repo-fixture.md))
owns the *creation* of a git repository. One file may do both — six files
shared with BL-1039 copy the live `swarmforge/scripts/` directory (this
ticket's concern) *and* run `git init` (BL-1039's) — and each guard names
only its own operation.

Of the seven originally-measured files, three (`gitHistoryAdapter.test.js`,
`blTopicStore.test.js`, `costHealthSidecar.test.js`) turned out to resolve
no live root at all — they spawn `git` into `mkTmpDir` temp dirs, which is
BL-1039's shape — and were reassigned there. This ticket's actual
live-repository readers are four files (~99.9s): `renderBriefingDiagramsCli`,
`renderBriefingBurndownCli`, `briefingDigestLineCli`, and
`emitLifecycleSnapshotCli`.

## How It Works

### The fixture — `extension/test/helpers/pinnedRepoFixture.js`

`copyLiveScriptClosureInto(targetScriptsDir, entrypoints)` builds a
fixture's `swarmforge/scripts/` from the **dependency closure** of the
named entry points, not by copying the whole live directory. The old
fixture builders copied every `.bb` file — 208 files, 2.16MB per build —
so every new script anywhere in the repo made every one of those builds
slower forever. The closure of one CLI's dependencies grows only with that
CLI's own dependencies; an unrelated new script elsewhere does not change
it, which is what makes the cost independent of the repository's size.

The closure is computed, never hand-listed: `resolveScriptClosure` walks
each entry point's `load-file` directives (mirroring
`master_checkout_drift_lib.bb`'s own dependency extraction) to a fixpoint,
keeping each dependency's full path relative to the scripts directory
rather than just its basename — a dependency named from segments (e.g.
`(fs/path (fs/parent *file*) "test" "x.bb")`) is copied into the same
subdirectory it lives in live, not flattened to the root (BL-1294). A name
the walker cannot resolve fails the build naming it — entry point or
dependency alike — so a fixture never goes silently incomplete (BL-1294;
before this, only a missing *entry point* threw and an unresolvable
dependency was silently dropped from the copy).

### The guard — `extension/test/helpers/liveRepoDerivationGuard.js`

`findLiveRepoDerivations(testDir)` scans every `*.test.js` file (skipping
the property lane) for a read whose *subject* is the live repository. The
boundary took four attempts to place, recorded in the source: flagging
every root resolution over-fired on O(1) single-file reads; flagging "root
bound and handed to code" over-fired because code given a root may read
one file or a thousand; flagging a growth operation anywhere in a file
caught BL-1039's own `git init` fixtures. The rule that held: **the growth
operation must target the bound live root, by name** — `git log`/`rev-list`
against it, a `readdirSync`/glob over it.

**The indirect case (`liveRootEscapesIntoProduction`).** The four headline
files never write a growth operation inline — they bind the live root and
hand it to a production module (`runCli`, `renderBriefingBurndown`,
`lifecycleSnapshotPath`), which does the reading. An architect review
caught the guard blind to this twice: the direct-pattern scan returned
`[]` for all four, so the guard's own "clean tree" test passed vacuously
against the majority of this ticket's own cost. The fix detects a live
root — bound variable or inline expression — passed as any argument to a
callee the file imports from `../out/`/`../src/`, closed to a fixpoint
through local wrapper functions (`runCli`, `runCliSubprocess`) so one
level of indirection doesn't hide it.

### Exemptions

A `// BL-1038-EXEMPT: <reason>` comment justifies a file that must read
the live repository. As with BL-1039's guard, the checked relation is that
a *reason* is present, not merely the marker. Six files carry a recorded
exemption:

| File | Why it must read the live repo |
| --- | --- |
| `renderBriefingDiagramsCli.test.js` | renders the real maintained `docs/diagrams/*.mmd` — the signal *is* that the real diagrams still render |
| `renderBriefingBurndownCli.test.js` | two of its tests are a smoke test that the real-repo fallback path still derives history; its other tests already run against a fixture snapshot |
| `briefingDigestLineCli.test.js` | proves the compiled CLI's thin `main()` wrapper is genuinely wired against the real repo — an in-process fixture run can't check that |
| `chaseTrendLineCli.test.js` | same wiring proof, one test |
| `emitLifecycleSnapshotCli.test.js` | resolves a path under the live root and restores the file afterward — a wiring check, not a repository walk |
| `pricingTable.test.js` | the live read *is* the assertion — it collects the models the repo's conf/packs actually reference and checks pricing coverage; a pinned copy would freeze the model list and hide a newly-referenced unpriced model |

None of the six is a blanket file exemption where every other call site
still exists unconverted — each reason names the one thing about that
file the shared fixture or a pinned copy cannot express.

### Where it is enforced

`extension/test/liveRepoDerivationGuard.test.js` runs in the default unit
lane and asserts `findLiveRepoDerivations(path.join(__dirname))` is empty
against the real `extension/test` directory. It also carries a standing
regression test for the indirect case specifically — reading the four
headline files from disk, stripping their exemption marker in-memory, and
asserting the guard still flags each — so a future change that blinds the
scan again fails loud instead of the tree quietly reporting `[]`.
`extension/test/pinnedRepoFixture.test.js`,
`extension/test/bl1038PinnedFixture.property.test.js`, and
`extension/test/bl1294FixtureClosurePathAndFailureInvariants.property.test.js`
(property lane) assert the fixture's own contract: the closure is derived
rather than hand-listed, a dependency's path within the scripts tree
survives the copy, and a missing name — entry point or dependency — fails
the build naming it rather than yielding a quietly smaller fixture.

## Scope: creation vs. read, and one file can be both

Six files converted here — `epicReorderBridge.test.js`,
`telegramFrontDeskBotCli.test.js`, `topicMakeTopBridge.test.js`,
`epicMakeTopBridge.test.js`, `pausedPagerBridge.test.js`, and
`commitIntegrityRunner.test.js` — also run `git init` for their own
repository, which is BL-1039's concern and is left untouched here. The
acceptance feature's scenario 07 exists specifically to assert this
boundary: a file that both resolves the live repository root *and*
creates its own git repository is flagged only for the live read, never
for the creation.

## Human-Facing Surface

None. This closes a cost and a growth term in the unit test lane itself —
no extension command, setting, or UI changes.
