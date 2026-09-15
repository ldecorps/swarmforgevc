# BL-1575 - specifier census on the coder's unowned-red note of 2026-09-15

The coder's priority-00 note (03:27Z, to specifier and coordinator):
`unowned-red bl1495BaiGatewaySeatSteps.js: mkSocketFixtureRoot not defined`.
Its BL-1486 evidence (coder branch, `BL-1486-coder-20260915.md`) records
the feature's pre-existing `# fail 7` both with and without the staffing
hatch and withholds the forward. The feature had no row in
`backlog/standing-reds.tsv` and no open ticket named it.

## Reproduction on `main` 228a4b6b3d (specifier, this pass)

`specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1495-a-b-ai-gateway-seat-launches-respawns-and-authenticates.feature <scratch>`
- 6.0 s wall, exit 1, `# pass 0 / # fail 7`. Every scenario fails at the
Background step `Given a steward registry fixture where
tencentcloud2/glm-5.3-flash is certified ...` with
`mkSocketFixtureRoot is not defined`.

Proof the missing require is the whole defect: a scratch steps module
that sets `global.mkSocketFixtureRoot = require('<repo>/specs/pipeline/steps/lib/socketFixtureRoot').mkSocketFixtureRoot`
and then re-exports the real `steps/index.js`, passed as the runner's
third argument, gives `# pass 7 / # fail 0` in 6.1 s on the same tree.

## Mechanism and first red

- `bl1495BaiGatewaySeatSteps.js` requires only `node:assert/strict`,
  `node:fs`, `node:os`, `node:path`, `node:child_process` (lines 12-16)
  and calls `mkSocketFixtureRoot` at lines 82, 116 and 224.
- `git log -- specs/pipeline/steps/bl1495BaiGatewaySeatSteps.js`:
  91fff24b96 (BL-1495 mint, local `mkTmpDir`), 046a7d9b84 (BL-1410,
  2026-09-09 02:02, "migrate 11 step handlers from mkTmpDir to
  mkSocketFixtureRoot"), f1c26a1cd5 (BL-1410, blank lines). The 046a
  hunk for this file deletes `mkTmpDir` and rewrites the three calls; no
  `+` line adds a require. The other nine migrated handlers plus bl743
  all carry `require('./lib/socketFixtureRoot')` (per-file sweep of the
  commit's file list: `uses=N import=1` for each, bl1495 `uses=3 import=0`).
- BL-1410's scenario 01 Examples pin BL-551, BL-565, BL-664 and BL-771 -
  none of the ten handlers 046a migrated - so the migration's own gate
  never ran the BL-1495 feature (BL-1445's population-pin shape).
- The `fixtureRoots` array and `process.on('exit')` sweep (lines 39-44)
  survive the migration with nothing pushing into them: dead, harmless.

## Lane census (main 228a4b6b3d)

`grep -l 'mkSocketFixtureRoot(' specs/pipeline/steps/*.js | wc -l` -> 123.
`... | xargs grep -L "require('./lib/socketFixtureRoot')"` ->
`specs/pipeline/steps/bl1495BaiGatewaySeatSteps.js` only. That count and
the two named members are scenario 03's pin.

## Disposition

- BL-1575 minted `type: defect`, `severity: high` (standing red), owner of
  the acceptance-lane row added to `backlog/standing-reds.tsv` in the
  same commit.
- Holder: coder, BL-1486 parcel (3e9a787980 / merge 97f0d9075d), forward
  withheld. Note sent after the mint commit: `BL-1486: bl1495 red owned
  by BL-1575 (<sha>) - resume forward`. Coordinator: paused-item-ready
  note.
- `bb swarmforge/scripts/standing_red_register_cli.bb` run after the row
  landed; result recorded in the commit's summary line below.

## Register result after the mint commit (51881d1c49)

`bb swarmforge/scripts/standing_red_register_cli.bb .` -> count 13, oldest
8 days, BL-1575's row `owned: true`, ONE unowned row:
`shell  swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh  BL-1569`.
BL-1569 closed at e83cb56f60 with the row left behind (the stale-row
shape of the BL-1574 pass). The test run on main 51881d1c49 this pass:
`operator_runtime hotfix-certification-sweep smoke: ALL CHECKS PASSED`,
exit 0, 6.1 s. The row is retired in the follow-up commit that carries
this section; after it the register reports no unowned row.
