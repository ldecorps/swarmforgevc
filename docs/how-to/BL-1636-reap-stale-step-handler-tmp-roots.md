# Reap stale step-handler temp roots when `os.tmpdir()` is slow (BL-1636)

## When to run this

`os.tmpdir()` listings (`fs.readdirSync`) slow down as the directory fills
with leaked acceptance step-handler fixture roots — every `bl`-prefixed
directory a handler's `mkdtempSync` created but never cleaned up. Thirty-five
code paths list `os.tmpdir()`, six of them at every step-registry load, so a
large backlog of leaked roots is a standing tax on the unit lane, the
property lane, and every acceptance run, not just a disk-space concern.

Run the reap when a host's temp-directory listing feels slow, or as part of
routine host upkeep — never inside a running lane.

## How to run it

With **no unit, property, or acceptance lane alive on the host**
(`pgrep -af 'node.*vitest'` empty, no `run_acceptance.sh` in progress):

```bash
node specs/pipeline/scripts/reap_stale_tmp_roots.js --dry-run
node specs/pipeline/scripts/reap_stale_tmp_roots.js
```

The script lists `os.tmpdir()` once, filters to `bl`-prefixed entries older
than its floor (`--older-than-hours`, default 24), skips any name whose
embedded pid is still alive (a live run's own root, regardless of age), and
removes the rest — never touching non-`bl` entries or anything outside the
target directory. It prints the removed count.

## Preventing new leaks

`extension/test/stepHandlerTmpRootGuard.test.js` is a standing unit-lane
guard: any `specs/pipeline/steps/*Steps.js` file that calls `mkdtempSync`
without registering its root (`fixtureReaper.js`'s `trackedTmpRoot(prefix)`,
or an existing sweep helper) fails the guard unless it is already named in
the committed census `extension/test/step-handler-tmp-root-census.txt`. A
new handler should call `trackedTmpRoot(prefix)` instead of `mkdtempSync`
directly — one call creates the root and registers it for reaping on normal
exit or SIGTERM.

The census itself only ever shrinks: fixing a census-listed handler removes
its entry — do not leave a now-clean handler's name in the file.

## A property test's own blind prefix sweep is a different hazard (BL-1623, BL-1677)

Separately from step-handler leaks, a property test that lists its whole
`os.tmpdir()` and removes every entry sharing its fixture prefix
(`for (const entry of fs.readdirSync(os.tmpdir())) if
(entry.startsWith(PREFIX)) rmSync(...)`, run before each invariant) can
`rm -rf` a concurrently-running peer's live fixture root — a second lane of
the same file, a guard re-run, or a solo re-run beside another lane all
alias into the same prefix. `test/helpers/tmpDir.js`'s
`sweepStaleTmpDirs({ prefix })` (BL-1623) is the owner-aware replacement:
it reaps a root only when the pid encoded in its name is dead or is the
sweeping process's own, never a live peer's. `test/helpers/blindTmpDirSweepFinder.js`
guards against a new blind sweep creeping back in — it reports both the
literal `readdirSync(os.tmpdir())` call and the aliased form (`const
parent = os.tmpdir(); … readdirSync(parent)`, whatever local identifier is
bound), and `extension/test/blindTmpDirSweepGuard.test.js`'s
`MIGRATED_FILES` census is the standing allowlist of files already using
the safe helper — eleven as of BL-1677 (the seven BL-1623 migrated plus
`bl1354SharedPathLandedSiblingInvariants`,
`bl1389UnlandedSiblingPathNeverRidesInvariants`,
`bl1380ExpediteNeverAnswersUnshownQuestion`, and
`bl1239SuiteManifestAccountsForEveryTestFile` — the last four aliased
`os.tmpdir()` into a variable, which is why the finder's original
literal-only pattern read the live tree as clean while all four still
blind-swept). A new property test with its own fixture prefix should call
`sweepStaleTmpDirs` from the start rather than writing a local sweep.

See also: `swarmforge/constitution/articles/reference/engineering-detailed.prompt`
§"Test Speed And Isolation" for the guard's full mechanics and prior
mkdtemp-leak incidents (BL-971, BL-1385/BL-1390, BL-1623).
