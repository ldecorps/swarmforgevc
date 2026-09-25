# Disposition (specifier, 2026-09-25)

Drained without a question: the intake's asks were concrete, and the root
cause was found at mint. On the shared main checkout,
`bl874PortableTimeInvariants` (894 MB alone) and `tempDirTrapGuard`
(1778 MB) walk the repository root through `walkFilesTolerant`. That walk
skips `.worktrees` but not the gitignored `.swarmforge/`, whose
`operator/vscode-cli/` holds 475 MB of `.js`. That makes two heap deaths in
every main-checkout refusal and none in any worktree.

- **Ask 1 (find and fix) + ask 3 (re-measure the census)** → **BL-1729**
  (defect, high, expedited, auto-approved). The walk never opens the root's
  `.swarmforge/` or `tmp/`, and the census is regenerated from one
  completing lane run: 458 files, 32 unmeasured at mint. Register rows for
  both files were added in the mint commit, owner BL-1729.
- **Ask 2 (a heap-cap death names its file)** → **BL-1730** (defect,
  medium, pending review).
- **"Keep it current when property files are added"** was not minted as a
  standing guard. Once BL-1730 lands, a file that grows past the cap names
  itself on every lane run, which is the detection the census was for. A
  row-per-file guard would add a measuring step to every parcel that adds a
  property file. Recorded in BL-1729's `out_of_scope`.
- The side finding (bl1703OllamaLaunchProbe) is BL-1727's: it is active and
  owns that register row.

# INTAKE — DEFECT: the property lane dies on the V8 per-worker heap cap again (BL-1651's crash is back), so every commit touching extension/src is refused unless the guard is overridden

**Source:** filed by the operator (Claude Code) at the human's go-ahead,
2026-09-25. Asked: "The regression matters beyond this hotfix: it blocks
every `extension/src` commit on `main` unless someone overrides the guard.
Want me to file it as an intake for today's day shift, citing BL-1651 and the
three refusal logs?" The human, verbatim:

> Ok

**Kind:** defect. **Recommended severity: high.**
- Today the pre-commit property guard (`check_property_suite_drift.sh`)
  refuses every commit staging `extension/src/*` or `*.property.test.js`
  unless it is overridden.
- BL-1651's own title records the other half: when the lane crashes, roles
  skip it "per run-once", so no parcel's property lane is verified.
- Note for the specifier: under Article 3.2.4, `type: defect` +
  `severity: high` is promoted ahead of every non-expedited ticket, including
  today's queue-jumped local-LLM slices. Grade it by the rule. The human was
  told about this consequence when the intake was filed.

## What happens

The full property lane crashes with the same signature three times out of
three, on the shared `main` checkout:

    FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
    ...
    Serialized Error: { code: 'ERR_IPC_CHANNEL_CLOSED' }
    Commit rejected: property suite failed.

| Refusal log (`.swarmforge/property-guard-refusals/`) | Lane budget line |
|---|---|
| `refusal-000003-20260924T183530Z.log` | forks=14 workerHeapMB=640 fileHeapCeilingMB=544 freeRamMB=5505 |
| `refusal-000004-20260924T191443Z.log` | (same shape) |
| `refusal-000005-20260925T063503Z.log` | forks=15 workerHeapMB=640 fileHeapCeilingMB=544 freeRamMB=18031 |

**It is not host memory.**
- The third run had ~17 GB available, no Ollama model loaded and the swarm
  stopped.
- Two workers each died about 2.4-3.1 s after starting.
- The GC trace shows ~616 MB still live after a full mark-compact, peaking at
  ~667 MB against the 640 MB cap.

**The commit being refused was unrelated:** the `think:false` field in
`extension/src/tools/localQwenSeatLive.ts`. Its own local-seat test files
(8 files / 78 tests) pass. When this intake was filed it was still staged,
waiting for the human to commit it with `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`.

## What was measured (2026-09-25)

**The census is stale.**
- BL-1651's census (`extension/test/property-lane-heap-census.txt`,
  generated 2026-09-19, cap=640MB forks=12) peaks at 208 MB per file
  (`bl1277StepCollisionInvariants`).
- The lane now has 457 property files against 426 census rows, so 31 files
  have never been measured.
- 27 of the 49 property files added or changed since BL-1651 closed on
  2026-09-20 are among them.

**No single recent file reproduces it.**
- Each of those 49 files was run alone under `vitest.properties.config.mjs`:
  48 pass and none hits the heap limit.
- So the offender is not one recent file on its own. It is either an older
  file whose imports grew, or heap accumulating across files in a reused fork
  worker, or something that depends on concurrency.
- Per-file results:
  `/tmp/claude-1000/-home-carillon-swarmforgevc/a73314c5-fb82-4d82-a4d9-1ba5efa60952/scratchpad/heap-bisect/summary.txt`
  (host-local scratch; the refusal logs above are the durable evidence).

**BL-1651's gate did not name the offender.** The per-file ceiling (544 MB)
never reported a file: V8 killed the worker at the cap first. So a fast
allocation outruns the gate, and every regression of this class arrives as an
anonymous `ERR_IPC_CHANNEL_CLOSED`.

**Side finding, for BL-1727 rather than a new defect.**
- `bl1703OllamaLaunchProbe.property.test.js` fails alone three out of three
  on an idle host: "expected pid … to be stopped".
- The standing-red register has it owned by BL-1727 ("ollama_ancillary_stop_pid
  sends TERM and never waits; green on main at load 3.1"). On this host it is
  not load-dependent.

## Ask

1. Find the file (or the cross-file accumulation) that takes a fork worker
   past 640 MB, and fix it. Don't just raise the cap: BL-1651 already sized
   the cap to the host.
2. Make a worker that dies at the heap cap name the test file(s) it was
   running, in the lane output and in the refusal log. Then the next
   regression identifies itself and stops being an `ERR_IPC_CHANNEL_CLOSED`
   hunt.
3. Re-measure the census so it covers the 31 unmeasured files, and keep it
   current when property files are added.

Draft acceptance (the specifier refines at mint):

```gherkin
Scenario: The full property lane runs to completion on this host
  Given main with no override in the environment
  When the pre-commit property guard runs the full property lane
  Then no fork worker dies on the heap cap
  And a commit staging only extension/src changes is not refused for it

Scenario: A worker that dies at the heap cap names its file
  Given a property file that allocates past the worker heap cap
  When the property lane runs
  Then the lane output names that file
  And the refusal log names that file

Scenario: The census covers every property file
  When the property-lane heap census is regenerated
  Then every property test file in extension/test has a census row
```
