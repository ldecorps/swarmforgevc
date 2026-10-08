# BL-2065 QA hold on an unowned red (2026-10-08)

parcel_commit: 04720240fa
red: extension/test/bl2055RestartOnlyOnHeldParcelInvariants.property.test.js

## The parcel's own gates, all clean

qa-gather at 04720240fa, one run (tmp/BL-2065-gather.json): sibling VERIFY; register exit 0;
pre_qa_gate OK (required_wiring bl2065LiveBuildFromMainSteps.js::registerSteps); unit exit 0
(250 s); property_runners exit 0; acceptance BL-2065 4 of 4 ok (qa_e2e 1: 01 x3, 02);
stragglers after: none. properties exit 1 on the one red below, in a file this parcel does
not touch (`git diff --stat origin/main...04720240fa` names no bl2055 path).

- qa_e2e 2: `node specs/pipeline/cli.js specs/features/BL-328-merged-code-reaches-running-daemons.feature`: 9 of 9 ok (TAP ok 7, the failed-build respawn the ticket calls scenario 08, included).
- qa_e2e 3 is post-land (the next live "stale-build-detected recompiling before respawn"
  line, BUILD_SHA equal to `git rev-parse main`, master `git status --porcelain` unchanged).
- Review: ensure-current-build! delegates to safe-recompile-lib/recompile-extension-from-main!
  with `git rev-parse main` (the ref node-build-stale? compares); `git archive <sha> --
  extension` reads only the committed tree; compile runs in a mkdtemp dir; BUILD_SHA stamped
  with the sha told; out/ swapped in; every failure returns a string so the respawn still
  happens (BL-328 scenario 08). extension's compile is `tsc -p ./` + stampBuildSha.js, and
  tsconfig.json reaches nothing outside extension/, so the archived subtree is complete.
- Checked by hand on a scratch fixture through safe_recompile_cli.bb: the live
  extension/node_modules (two files, one nested) survives the recompile's
  `fs/delete-tree` of its temp dir (the symlink is removed, not followed), no
  sfvc-safe-recompile-* dir is left behind, BUILD_SHA names main.
- Hardener: five hand-mutants over safe_recompile_lib.bb, all killed (the fifth by the
  node_modules-resolution test it added in 6497fa49ec).
- Docs: BL-1154 how-to describes the front-desk fix; BL-629 reference states that `sync`'s
  recompile-extension! still compiles the working tree. The specifier's amendment
  04a82ccc6e makes that the ticket's Living docs bullet and mints BL-2082 for the sync path.
- Observation, not a defect: stage-and-swap-out! deletes the live out/ and then renames the
  staged copy in, so for the length of the delete-tree there is no out/; the ticket's How
  says "atomically" as direction only.

## The red

`npm run test:properties`, one run at 04720240fa (gather row `properties`, exit 1).
Verbatim:

```
FAIL  test/bl2055RestartOnlyOnHeldParcelInvariants.property.test.js > property (BL-2055 invariant 1): a restart carries only the override for the parcel in in_process, whatever else sorts first
Error: reach floor: BL-2055 invariant 1 held/noHeld shape held drawn 8 < 10
 ❯ test/bl2055RestartOnlyOnHeldParcelInvariants.property.test.js:156:3
```

The gather's register_join reads `absent`. No row in backlog/standing-reds.tsv or the
property allowlist names the file, and no open ticket mentions it (the only hits are
BL-2055's own done-ticket evidence).

Mechanism, read from the test (lines 115-156): invariant 1 draws `hasHeld` with
`fc.boolean()` over `numRuns: 30` and then asserts a reach floor of 10 per shape
(`INV1_FLOOR`). A sampled floor, not a constructed one: with X ~ Binomial(30, 1/2), either
shape lands under 10 when X <= 9 or X >= 21, about 4% of runs. That is a rare-sample
assertion, the shape BL-1062 says to construct rather than sample; this run drew 8 held.

The parcel is held, not bounced: it did not cause the red. The red needs an owner before
this parcel is approved (Article 4.2).

By QA.
