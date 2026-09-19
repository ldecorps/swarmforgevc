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

See also: `swarmforge/constitution/articles/reference/engineering-detailed.prompt`
§"Test Speed And Isolation" for the guard's full mechanics and prior
mkdtemp-leak incidents (BL-971, BL-1385/BL-1390, BL-1623).
