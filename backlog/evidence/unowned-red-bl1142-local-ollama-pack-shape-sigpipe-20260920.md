# Unowned red found while implementing BL-1459, 2026-09-20

Not BL-1459's own defect - this parcel never touches
local_ollama_pack_shape_lib.sh or anything Ollama/pack-shape related.

## test/bl1142LocalOllamaPackShape.property.test.js > "BL-1142 local Ollama
pack shape > mono depth-1 router is always mono-router"

Failed once in a full `npm run test:properties` run:

```
Caused by: AssertionError: Expected values to be strictly equal:
141 !== 0
 ❯ classify test/bl1142LocalOllamaPackShape.property.test.js:24:10
```

Line 24 is `assert.equal(r.status, 0, r.stderr || r.stdout)` inside
`classify()`, which spawns a real `bash -c` subprocess (piping a fixed
config body via `input:`) and asserts its exit status is 0. Exit 141 =
128+13 = SIGPIPE. The test's own generator is `fc.constant(null)` -
deterministic, not randomized - so this is not a generator-reach flake
like BL-1340/BL-1368 (both seen earlier this session); it is subprocess
contention under the full property lane's concurrent load (many files
spawning many real subprocesses at once), consistent with a broken pipe
on the `input:` write to a bash child that was momentarily unable to
read it. Re-ran `npx vitest run --config vitest.properties.config.mjs
test/bl1142LocalOllamaPackShape.property.test.js` in isolation
immediately after: 3/3 green.

`grep -i bl1142 backlog/standing-reds.tsv` finds no row. Third
non-reproducible-in-isolation property-lane flake this session across
three unrelated files (BL-1340 generator-reach, BL-1368 generator-reach
- now owned by BL-1656 - and this one, a subprocess SIGPIPE under
contention) - a distinct failure mechanism from the other two, so
probably not the same root cause, but worth the specifier's own look at
whether `classify()`'s subprocess spawn needs retry-on-SIGPIPE or a
different input-passing mechanism under concurrent load.

By coder.
