# Defect: swarmCostRankCli.test.js is broken on main (3 failures), unrelated to BL-566

Discovered 2026-07-23 during BL-566 QA verification (full unit suite run). Confirmed
pre-existing and unrelated to BL-566: `git diff` between the pre-BL-566 QA head
(dfbd23d4d) and the merged head touches zero files under
`extension/{src,out,test}/**swarmCostRank**` or `llmCostLedger*`. Reproduces in
isolation (`npx vitest run test/swarmCostRankCli.test.js` from `extension/`), so
it is not test-order flake.

Failing (extension/test/swarmCostRankCli.test.js):
- `main: prints ranked JSON sorted by cost descending` — expects `[5, 1]`, gets `[]`
- `main: with a groupBy dimension, prints rollup groups instead of individual records` — expects 2 groups, gets 0
- `the compiled CLI runs standalone as a subprocess and prints ranked JSON` — expects 1 record, gets 0

All three read back zero records where records were expected — looks like a read-side
regression in the ledger/rank path (`extension/src/tools/swarm-cost-rank.ts`,
`extension/src/metrics/llmCostLedger*.ts`), landed under BL-551 (already in
backlog/done) per `git log` on those files. Last touching commits: 4a051b835
("Restore ModelFactory + BL-551 work reverted by QA-branch merge"),
78fabf968 ("Revert \"Merge commit '7c5c9ecb21' into swarmforge-QA\""),
980b30710, b7180e78e, beba65655 — worth checking whether one of the two revert
commits is the actual regression point.

Not blocking BL-566 (unrelated files, confirmed by diff) — BL-566 was verified and
approved independently. Filing here per the no-out-of-bounds-changes-without-spec
working agreement: this needs its own ticket and Gherkin coverage, not a silent fix.
