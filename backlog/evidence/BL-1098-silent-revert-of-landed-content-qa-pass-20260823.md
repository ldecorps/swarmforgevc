# BL-1098-silent-revert-of-landed-content — QA pass — 20260823

Documenter tip merged: `e927e5b305`. Hardener `58da5edacb` and coder `3b9a7c9d9e` are
ancestors of the cited tip (asserted before approve).

## Review inventory (Article 4.4)

NONE.

## Gates run

- Sibling check: `VERIFY BL-1098` (exit 0).
- Prior architect bounce (`6f5ff0a23`, multi-ticket parcel with BL-1081):
  cleared on this tip — `origin/main...HEAD` has no ACP-host paths.
- `cd extension && npm run compile`: clean.
- Unit (`cd extension && set -a && . /home/carillon/swarmforgevc/.swarmforge/swarm.env && set +a && node scripts/recordTestDuration.js`):
  parcel-green. Standing outside-parcel reds only —
  `sampleResourcesCli.test.js` (3) and `strykerSandboxSiblingsLib.test.js` (4);
  `grep -rl` over `backlog/{active,paused,hold}` empty (BL-1063; coordinator
  noted on prior parcel).
- Properties (`cd extension && npm run test:properties`): 161 files / 477
  tests green. One `[vitest-worker]: Timeout calling "onTaskUpdate"` — known
  benign artifact, allowlisted.
- Acceptance: `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1098-silent-revert-of-landed-content.feature` — 7/7 pass.
- Babashka: `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb` —
  ALL TESTS PASSED (includes silent-revert assertions).
- `required_wiring` `swarmforge/scripts/push_sweep_lib.bb::silent-revert`:
  `silent-revert-path?` / `silent-revert-decision` consulted from the live
  `push-sweep!` path via `:silent-revert-gate-facts!` in `handoffd.bb`
  (`push-sweep-silent-revert-gate-facts!`).
- `required_wiring` `specs/pipeline/steps/index.js::bl1098`:
  `require('./bl1098SilentRevertSteps')` registered; exercised by
  acceptance.
- Ticket invariants (git-objects-only verdict; tip matching newest authoring
  never flagged; cost bounded by merge-touched paths): encoded in lib +
  property runner + acceptance scenarios 03/04/05.
- Orphans: no leftover `node --test` / `stryker` after gates.

## Intent

Push sweep refuses a tip that holds superseded content no commit authored,
names path + newest authoring sha + divergence merge, and stays quiet on
correct reconciles and clean stage merge-ups — matches the ticket.

By QA.
