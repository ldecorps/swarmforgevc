# Coder unowned-red note on the BL-1588 parcel - specifier adjudication (2026-09-16)

Inbound: `00_20260916T091925Z_001975_from_coder_to_specifier` (recipients
specifier, coordinator), "unowned-red: bl1375/1309/1389/1529 property
timeouts; BL-1588 evidence file". Coder evidence, untracked in the coder
worktree at adjudication time and landing with BL-1588's parcel:
`backlog/evidence/BL-1588-coder-full-lane-reproduction-20260916.md`.

## What the coder observed

One full `npm run test:properties` run (408 files, 319.94 s wall,
10:12:06 to 10:17:26 UTC) on the coder worktree tip after merging main's
`65fca0e708`, before BL-1588's own change: 8 files red. Host at start:
1-minute load 8.67, 20 CPUs, `WORKER_POOL_SIZE` resolved to 11 forks.
Three of the eight are BL-1588's named files (bl1308, bl1315, bl1354;
bl1343 was green this run). The other four:

| file | test | wall | message |
|---|---|---|---|
| bl1375ApprovedSiblingsCanLandInvariants | invariant 1 | 21596 ms | `Error: Test timed out in 20000ms.` |
| bl1309LandDecideEntanglementInvariants | invariant 1 | 23211 ms | `Error: Test timed out in 20000ms.` |
| bl1389UnlandedSiblingPathNeverRidesInvariants | invariant 1 | 22437 ms | `Error: Test timed out in 20000ms.` |
| bl1529ScriptSenderAuditOutcomesInvariant | the declared invariant | 74454 ms | `Error: Test timed out in 60000ms.` |

The coder declined to grow BL-1588's scope, citing the ticket's own
"population pinned by NAMED files, not by grep" constraint (BL-1445), and
reported them separately. That reading is correct.

## Ownership check

- `grep -rlE 'bl1375ApprovedSiblings|bl1309LandDecide|bl1389UnlandedSibling|bl1529ScriptSender' backlog/paused backlog/active`
  is empty. `grep -nE 'bl1375|bl1309|bl1389|bl1529' backlog/standing-reds.tsv`
  is empty. `bb swarmforge/scripts/standing_red_register_cli.bb .` before
  this pass: 5 rows (BL-1588 x4, BL-1589 x1), all owned, `"unowned":[]`.
- BL-1578 (closed) owned bl1529 for its sampled reach floor, a different
  defect class; the file's "BL-1578 reach map" log line is that fix.
- Genuinely unowned under Article 4.2 for all four.

## Verification of the class (read, not guessed)

- None of the four requires `propertyLaneContentionBudget` (only bl1343 and
  bl1323 do, `grep -rl propertyLaneTimeoutMs extension/test/`).
- bl1375, bl1309, bl1389: three `it(` each, no third argument, so the
  lane's flat `testTimeout: 20000` (`extension/vitest.properties.config.mjs:62`)
  is their whole budget. Each spawns `bb`, `git` or `bash` per draw inside
  the property body against a real git fixture; bl1375 also runs
  `check_feature_handler_registration.sh` per draw (line 254).
- bl1529: one `it(`, third argument the bare literal `60000` (last line of
  the test). A per-test argument overrides the config's `testTimeout`, so a
  config-level derivation, should BL-1588 choose that route, cannot reach
  it. Its solo wall time is on no evidence file; 74 s under the full lane
  against a 60 s budget.
- The coder's in-flight BL-1588 handler
  (`.worktrees/coder/specs/pipeline/steps/bl1588FullLanePropertyTimeoutSteps.js`)
  resolves `propertyLaneTimeoutMs(base, { forksFn, loadavg1mFn })`: the
  per-file helper route with a fork-count seam. Either route leaves these
  four files with the work described in BL-1592.

## Why a new owner and not an amendment of BL-1588

- BL-1588 is active at the coder. Its scenario 01/02 examples pin four
  files; growing them to eight mid-flight amends a feature file whose
  parcel is at the coder (allowed) but doubles the e2e run count and
  contradicts the constraint the coder just obeyed.
- bl1529's 60000 base is distinct work (a bare per-test constant, not an
  absent budget) with its own scaling assertion (scenario 04).
- Both tickets touch the budget helper and the lane config, so they cannot
  be active together (Article 3.2.3); `depends_on: [BL-1588]` sequences
  BL-1592 after the mechanism lands, and the promotion gate refuses it
  until then.

## Outcome

Minted BL-1592 (`type: defect`, `severity: high`, epic code-quality-gates,
`depends_on: [BL-1588]`) owning all four files; four register rows added
naming it (first_seen 2026-09-16); the coordinator sent the paused-ready
note and the coder (holding BL-1588) the owner note so BL-1588's evidence
can cite BL-1592 by id. No parcel is withheld on these reds today.
