# Host-resolved Stryker mutation concurrency (BL-786)

## The gap

Stryker configs pinned `"concurrency": 1` after a Mac-only hotfix (BL-789),
leaving most cores idle on this Linux host. BL-427 measured per-worker peak
RSS (~783 MB) and shipped `recommendMutationConcurrency`, but no mutation
entry point called it — every run used the frozen config value.

## What changed

| Piece | Change |
| --- | --- |
| `extension/scripts/mutation-concurrency.js` | Shared wrapper for every mutation npm script |
| `extension/src/tools/resolve-mutation-concurrency.ts` | Reads host RAM/cores, applies BL-427 peak + reserve, honours pins |
| `extension/src/metrics/mutationConcurrencyConstants.ts` | Single declared peak (`821121024` bytes) citing BL-427 |
| `extension/package.json` | `mutation` and `mutation:lets-talk-cursor-bridge` route through the wrapper |

At launch the resolver prints the chosen concurrency, whether it was computed
or pinned, and the inputs (`free_ram_mb`, `cores`, `peak_rss_per_worker_mb`,
`reserve_mb`). Stryker receives `--concurrency N`, overriding the config file.

Entry points (enumerate from `extension/package.json` at run time):

- `npm run mutation`
- `npm run mutation:lets-talk-cursor-bridge`

`stryker.letsTalkCore.config.json` remains an orphan config with no npm
script — out of scope until a script is added.

## Operator note

**Pin a run** when you need a specific worker count (e.g. leave RAM for
something else on the box):

```bash
MUTATION_CONCURRENCY=4 npm run mutation
```

Or pass `--pin` to the wrapper directly:

```bash
node extension/scripts/mutation-concurrency.js run --pin 4 -- stryker run
```

A pin always wins over the computed value; stderr labels it `(pinned via
MUTATION_CONCURRENCY=…)`.

**Read the sizing inputs** without starting Stryker — run any mutation script
and read the first stderr lines, e.g.:

```text
mutation-concurrency: 10 (computed)
  free_ram_mb=10282 cores=20 peak_rss_per_worker_mb=783 reserve_mb=2048
```

**Refresh the declared peak** only after re-measuring per
[BL-427](reference/BL-427-mutation-worker-rss-measurement.md); change
`DECLARED_PEAK_RSS_PER_WORKER_BYTES` in `mutationConcurrencyConstants.ts`
once, not per config file.

Verify:

```bash
node --test extension/test/resolveMutationConcurrency.property.test.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-786-mutation-concurrency-host-resolved.feature
```
