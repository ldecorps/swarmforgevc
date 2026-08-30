# BL-1240 — coder rework of QA bounce D1, 2026-08-30

Bounce: `backlog/evidence/BL-1240-unregistered-test-fails-the-ticket-that-adds-it-bounce-20260830.md`
(one item, D1). Fixed at the root cause QA pointed at, without weakening a
single assertion in either regressed test file.

## D1 — FIXED

`extension/test/helpers/pinnedRepoFixture.js` built a fixture's
`swarmforge/scripts/` FLAT: `loadFileDeps` reduced every dependency to
`path.basename(...)`, so `(fs/path (fs/parent ...) "test"
"suite_inventory_lib.bb")` was recorded as the bare `suite_inventory_lib.bb`,
`copyScriptClosure` looked for it at the flat root, did not find it, and
skipped it silently. Every fixture-built `bb swarm_handoff.bb` then died on
load with a `FileNotFoundException`, which `enqueueRoleAnswerNote` swallows
(BL-410 posture) — so it surfaced as a dedup violation in a test about
something else entirely.

Three changes, all in that one helper:

1. `loadFileDeps` now keeps the path segments that precede the `.bb` name on a
   `load-file` line, normalised — the segments are part of the path the script
   builds, not decoration. A single-segment dependency is still its own
   basename, so every existing closure is byte-identical.
2. New `resolveDepPath(referrer, dep)`: a dependency is resolved against the
   directory of the file that NAMES it, so a script inside `test/` reaching
   back out with `".."` names the root copy rather than a second one under
   `test/`. `resolveScriptClosure` walks through it.
3. `copyScriptClosure` `mkdir -p`s each destination's parent before copying, so
   a dependency that lives in a subdirectory is copied into one.

Deliberately unchanged: a dependency that climbs OUT of the scripts root keeps
its normalised name and is skipped by the copy exactly like any other name the
reader cannot resolve — `resolveScriptClosure`'s documented contract, and the
existing test that pins it still passes untouched.

## TDD

Four tests written first, all four red against the old helper, all four green
after (`extension/test/pinnedRepoFixture.test.js`):

- a `load-file` into a subdirectory keeps the subdirectory
- a dependency is resolved relative to the file that names it (the `..` case)
- the copy reconstructs the subdirectory a dependency lives in
- **the live `swarm_handoff.bb` closure carries its `test/` dependency** — the
  regression itself, against the real tree, not a mock of it

## Verification

| Command | Result |
|---|---|
| `npx vitest run test/pinnedRepoFixture.test.js` | 12 pass (8 pre-existing + 4 new) |
| `npx vitest run test/telegramFrontDeskBotCli.test.js` | **271 pass** (was 8 failing) |
| `npx vitest run --config vitest.properties.config.mjs test/telegramFrontDeskBotCli.property.test.js` | **pass** (was red on first draw) |
| `npx vitest run --config vitest.properties.config.mjs test/bl1038PinnedFixture.property.test.js` | pass |
| `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb` | ALL PASS |
| `run_acceptance.sh` on BL-1240's feature | 4/4 |

Every other `pinnedRepoFixture` consumer was run too — `epicMakeTopBridge`,
`epicReorderBridge`, `pausedPagerBridge`, `topicMakeTopBridge`,
`commitIntegrityRunner`, `bl1091ExpeditePromotionCommit`,
`bl687EpicTileSurfaceUntouched`, `bl892ApprovalCommitDurability`. The bridge
ones fail on this host, every failure with the same message:

    CURSOR_API_KEY is not set for the headless bridge.

That is the known environment leak, not this change: grepping the run for any
failure reason OTHER than `CURSOR_API_KEY` returns nothing, and the failures
are raised in `resolveCursorApiKey`, before any fixture script is read.
`commitIntegrityRunner` (the same helper, no bridge) passes.

Blast radius checked directly: `"test" "suite_inventory_lib.bb"` is the ONLY
multi-segment `load-file` target anywhere in `swarmforge/scripts/*.bb`.

## Surfaced, not acted on

**BL-1294 (`backlog/paused/BL-1294-fixture-script-closure-preserves-dependency-paths.yaml`)
was minted against this same root cause** — see
`backlog/evidence/BL-1294-telegram-front-desk-cli-property-triage-20260830.md`,
which reaches the identical diagnosis independently. QA routed the fix here, so
it is fixed here; BL-1294's substance is now satisfied by this commit. Whether
it is retired or kept for its own acceptance feature
(`specs/features/BL-1294-fixture-script-closure-preserves-dependency-paths.feature`,
which this parcel does not implement — it belongs to a ticket that is not
promoted) is the specifier's call, not mine.
