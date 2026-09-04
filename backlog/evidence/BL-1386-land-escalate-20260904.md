# BL-1386 — QA verification PASSED, landing LAND_ESCALATE (manual), 2026-09-04

## QA verification — PASS

Merged documenter `b1712aafe3` into QA worktree (merge commit `2cab559722`).
Lineage verified: this ticket's own coder (`b21734aae3`, the D1-bounce fix),
cleaner, architect, hardener (`9224693e01`) and documenter (`b1712aafe3`)
merges are all ancestors of `2cab559722`.

- `npm run compile` — clean.
- `npm run test` (extension/) — 26 failed / 9996 total, all pre-existing
  standing debt, zero overlap with this ticket's changed paths. Every
  failing file grepped against `backlog/`: BL-1221 (constitutionDocCitations,
  pilotAcceptanceGate\*, unreachableStepHandlerCheck\*), BL-1229
  (crossFileDuplicationCheck\*, multiBranchParserCoverageCheck,
  perHatRolePromptEvidenceCheck, pilotScopedCrapCheck\*,
  shellEntryPointDriveCheck), BL-1263 (backendSwitch, telegramClient,
  telegramCursorOperatorExec\*), BL-1265 (operatorRuntimeBbFixtureClosure\*),
  BL-627 (pricingTable, confirmed via memory
  `pricing-table-rates-are-wrong.md`), plus liveRepoDerivationGuard /
  socketFixtureShortRootGuard / tempDirTrapGuard standing reds. Per BL-1063,
  none re-reported.
- `npm run test:properties` — 19 failed test files / 7 failed tests, plus
  the allowlisted `[vitest-worker]` timeout (BL-871). Cross-checked every
  failing file against `swarmforge/scripts/property_suite_standing_allowlist.tsv`
  (BL-1175): all but two (`bl1253TokenOwnershipInvariants`,
  `bl956PipelineBoardCaptionCapInvariants`) present with
  `disposition=allowlist`. The two missing entries are both landed/`done`
  tickets (BL-1253, BL-956) unrelated to this parcel's changed paths — a
  standing-allowlist housekeeping gap, not a new regression. Per BL-1063,
  none re-reported.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` —
  ALL TESTS PASS.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb` —
  500 runs, ALL PROPERTIES HOLD, including live non-vacuity for the
  BL-1386 orphan-merge scenario ("a failed abort neither clears ownership
  nor falls through - the 2026-09-04 orphan cannot recur silently").
- `bash swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`
  — ALL SCENARIOS PASS, including the three BL-1386-specific wiring
  assertions (ownership file name agrees lib/daemon, failed-abort log label
  agrees, `absorb-with-merge!` no longer discards the abort result) and the
  three live-dispatch scenarios (D1: daemon reaches and acts on the
  ownership decision; an owned merge routes to abort, not the human
  reading; a live human's merge still routes to the human reading, BL-1120
  intact).
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1386-the-reconcile-sweep-never-orphans-a-merge-it-started.feature`
  — 7/7 scenarios pass.
- `required_wiring` — all three anchors verified live: `merge-abort-failed`
  label defined and logged (`handoffd.bb:3375,3533`),
  `master-main-merge-owner.json` filename defined and used
  (`handoffd.bb:3374`, `write-merge-owner!`/`clear-merge-owner!` called),
  `bl1386ReconcileOwnsItsMergeSteps.js::registerSteps` present (file
  discovery era post-BL-1371 — no `index.js` anchor expected, see memory
  `index-js-wiring-anchors-swept-0904-after-bl1371-discovery`).
- Wired into the real caller: `master-main-clear-merge-owner!` and
  `may-abort-failed-merge?` are called from the live sweep dispatch
  (`handoffd.bb:3516-3634`), not merely unit-tested in isolation. Confirms
  the D1 architect bounce (`bounce_history` on the ticket, fixed by
  `b21734aae3`) is resolved.
- `bounce_history`: one entry (architect, 2026-09-04, `7836b7364a`,
  blamed coder, class behavior — "next-tick abort-by-ownership never wired
  into the live daemon dispatch"). Fixed by `b21734aae3` ("wire
  abort-by-ownership into the live dispatch"), confirmed live above.
- Diagram currency: documenter checked the registry, correctly found no
  diagram depicts reconcile-sweep internals at this granularity — nothing
  to update.
- Ancestry check (not just "ancestor of HEAD"): `b1712aafe3`, `9224693e01`,
  `b21734aae3` are all ancestors of the cited commit `2cab5597226683d3246a26fb199757bc1b8d07fd`.

**Verdict: BL-1386's own implementation, tests, and approval are all sound.
QA approves the work itself.**

## Landing — LAND_ESCALATE (manual review, not the tool's own verdict)

`bb swarmforge/scripts/land_step_cli.bb
BL-1386-the-reconcile-sweep-never-orphans-a-merge-it-started 2cab5597226683d3246a26fb199757bc1b8d07fd`
returned `LAND_REPLAY land-replay/BL-1386-2cab559722 67cd1d8dd77f265a4228a6376762c4484ee19c45`
— nominally success, 27 `ENTANGLED_SIBLING` lines (BL-1296, BL-1309,
BL-1317, BL-1328, BL-1337, BL-1342, BL-1344, BL-1345, BL-1346, BL-1351,
BL-1354, BL-1356, BL-1359, BL-1360, BL-1367, BL-1369, BL-1371, BL-1374,
BL-1375, BL-1376, BL-1377, BL-1378, BL-1379, BL-848 plus BL-1387 twice
listed differently) and 17 `LANDED_SIBLING` lines.

Per this prompt's own instruction ("Review that tip and land `<new-commit>`,
never the originally-cited commit"), I reviewed the replay tip before
landing it — `git diff --name-only origin/main
67cd1d8dd77f265a4228a6376762c4484ee19c45`. It is **not tip-pure**: alongside
this ticket's own paths it carries substantial, unlanded, unrelated
sibling content:

- `extension/src/bridge/bridgeServer.ts` (+68/-6)
- `extension/src/concierge/pendingApprovalReply.ts` (+56/-2)
- `extension/test/bl1367ApprovalCarriesItsRuling.property.test.js` (new, 180 lines)
- `extension/test/pausedPagerBridge.test.js` (new, 139 lines)
- `extension/test/pendingApprovalReply.test.js` (new, 137 lines)
- `specs/pipeline/steps/bl1367ApprovalCarriesItsRulingSteps.js` (new, 125 lines)

All six are **BL-1367's own work** (`backlog/paused/BL-1367-an-approval-from-any-surface-carries-its-ruling.yaml`,
confirmed absent from `origin/main` — `git cat-file -e
origin/main:specs/pipeline/steps/bl1367ApprovalCarriesItsRulingSteps.js`
fails). BL-1367 has its own independent QA approval on record
(`backlog/evidence/BL-1367-land-escalate-20260903.md`: "QA verification —
PASS... QA approves the work itself") but its own land is **itself**
`LAND_ESCALATE`d when run directly just now (`bb
swarmforge/scripts/land_step_cli.bb BL-1367-an-approval-from-any-surface-carries-its-ruling
30fb549054` → `LAND_ESCALATE`, same 23-ticket entangled set, "tip-pure
replay could not complete cleanly"). BL-1367 is genuinely unlanded, not a
`land-escalate`-list false positive.

Also present: `specs/features/BL-1387-an-open-merge-nobody-owns-is-surfaced-as-orphaned-not-human.feature`
— BL-1387 is a currently-active sibling (still cycling architect/cleaner
bounces per its own evidence files), not approved, not mine to land either.

And one untraceable extra: `extension/docs/briefings/2026-09-03.json` — no
commit in `origin/main..HEAD` touching it names any ticket; likely
telemetry/briefing sidecar output committed incidentally by another role's
pass, absent from `origin/main`.

**I am not landing `67cd1d8dd7...` or the originally-cited `2cab559722`.**
Landing either would put BL-1367's and BL-1387's unapproved-for-main
content on `origin/main` under BL-1386's authorization — exactly what
Article "An Approval Authorizes Only Its Ticket's Work" (BL-506) forbids.

## Why this differs from the already-adjudicated shared-registry class

The 09-03 adjudication (`backlog/evidence/BL-1296-land-deadlock-shared-registry-20260903.md`,
retired per memory `shared-registry-land-deadlock-and-the-handler-files-first-route`
after BL-1371 landed) was about a SHARED path (`specs/pipeline/steps/index.js`)
replaying whole and dragging in every sibling's `require(...)` line. That
mechanism is gone post-BL-1371 (file discovery, no manual `index.js`
edits). This is a different shape: BL-1367's own EXCLUSIVE files (not a
shared path) are being included in another ticket's `own-paths` positive-
inclusion walk, most likely because `own-paths`' fail-safe default (a path
that fails to attribute cleanly and positively to an unlanded sibling ALONE
is never excluded — see `task_scope_gate_lib.bb`/`land_step_lib.bb`
docstrings on `:any-untagged?`) is treating BL-1367's content as
untagged/unattributable in this worktree's ancestry, rather than as
BL-1367's. This is a new manifestation of the same family documented in
memory `bl1354-fix-is-per-ticket-not-per-path-residual-false-escalate`
(exclusion is per-ticket, not verified per-path), not a re-report of the
retired shared-registry deadlock.

Note also: most of the 27 `ENTANGLED_SIBLING` names above are almost
certainly false positives by that same residual bug — I spot-checked
`bl1296BubbleSeatSteps.js`, `bl1309LandDecideStepEntanglementSteps.js`,
`bl1356StampOffWatchesTheRunSteps.js`, `bl1374SyncMergePassengersSteps.js`
and all four are already present, byte-identical, on `origin/main` (each
has its own `land-success-20260904.md`/`land-success-20260903.md` evidence
file). BL-1367 is the one I verified as a REAL, currently-unlanded
entanglement whose content is actually present in the replay diff.

## Disposition

Not a bounce — BL-1386's own work is sound and its approval stands. Per
QA-prompt land-step remedy step 3: escalating to the specifier
(priority `00` note) naming the conflicting paths, and stopping rather than
landing. Not re-escalating the retired shared-registry class; this is a
distinct, newly-observed manifestation of the per-ticket-not-per-path
`own-paths` gap, so it does not fall under "escalate once per class"
against the 09-03 evidence.

By QA.
