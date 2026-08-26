# BL-1048 architect pass — 2026-08-22

**Parcel:** cleaner forward `f9408d8aeb` ("BL-1048: a delivered parcel is not
not-started — scan inbox/new/ too"). Cleaner forwarded the coder's own commit
as-is (no separate cleaner commit) — `By coder.` at the tail is the only
author line. Merged into architect cleanly via
`clear_identical_untracked_and_merge.bb` (a large set of pre-existing
untracked-but-byte-identical `swarmforge/scripts/*` files from BL-924's own
known sync-leftover pattern blocked a bare `git merge`; all cleared candidates
proved byte-identical to the incoming ref before clearing, nothing else
touched). Ancestry confirmed: `f9408d8aeb` is HEAD after a fast-forward merge.

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation, no invariant violation, no correctness defect found.

## Review completed first (Article 4.4 — full inventory before judging)

- **Two-layer / extension-host boundary, webview storage, secrets:** N/A —
  no `extension/` TypeScript source touched. This is a `swarmforge/`
  maintained-fork Babashka change (`pipeline_stage_cli.bb`) plus a Gherkin
  feature, its step handlers, a property test under `extension/test/`, and a
  shell test — none of it VS Code host/webview/secrets surface.
- **Integrate-not-fork:** editing `swarmforge/scripts/*.bb` is normal
  maintenance of the maintained fork itself (local-engineering Architecture
  Rule 2), not the extension bypassing `./swarm`/`.swarmforge/` — no
  violation.
- **Dependency-rule gate (BL-259, hard gate):** attempted for real, not
  eyeballed. `node extension/out/tools/dependency-gate.js
  swarmforge/scripts/pipeline_stage_cli.bb specs/pipeline/steps/index.js
  specs/pipeline/steps/bl1048DeliveredParcelIsNotNotStartedSteps.js
  extension/test/bl1048DeliveredParcelIsNotNotStarted.property.test.js` fails
  outright — depcruise resolves scope paths relative to `extension/`, and
  none of this parcel's changed files live under `extension/src` or
  `extension/media` (the tool's only scope). Confirmed inapplicable, not
  skipped: this parcel touches zero files the gate's ruleset covers.
- **Co-change / logical coupling (BL-255):** `node
  extension/out/tools/co-change-report.js swarmforge/scripts/pipeline_stage_cli.bb
  specs/pipeline/steps/index.js swarmforge/scripts/test/test_pipeline_stage_cli.sh`
  — `pipeline_stage_cli.bb`'s only SUSPECTED COUPLING partners (frequency 3,
  at the default threshold) are `specs/pipeline/steps/index.js` and
  `swarmforge/scripts/test/test_pipeline_stage_cli.sh`, both already in the
  parcel. Board consumers (`pipelineBoard.ts`, `swarmState.ts`) show only 1
  co-change each — below threshold, and correctly not touched here (a source
  widening only, per the ticket's own "How" section and the commit's
  untouched-list). Nothing flagged outside the parcel.
- **Declared invariant 1** ("a ticket whose parcel has been delivered to a
  role is never rendered not-started"): encoded directly in the property
  test (`extension/test/bl1048DeliveredParcelIsNotNotStarted.property.test.js`)
  as its own assertion, not left implicit in the column check. Non-vacuity
  documented and independently plausible: reverting `scanned-mailbox-states`
  to `:in_process`-only would make every `delivered-only` draw fail on this
  assertion — read the code path by hand and confirmed `role-ticket-pairs-for`
  genuinely has no other source of the delivered ticket id in that revert.
- **Declared invariant 2** ("one ticket resolves to exactly one role...
  widening the scanned source set never reintroduces BL-464's double row"):
  encoded as the row-count assertion. Read `reconcile-stage-map` directly
  (`pipeline_stage_lib.bb:118-126`, confirmed byte-unchanged by this commit)
  — most-downstream-wins via `role-order` rank, `>` (strict) comparison so a
  same-role tie (both `:new` and `:in_process` observed at one door) keeps
  the first-seen pairing rather than re-deciding, which is correct since the
  role is identical either way. The property test's documented non-vacuity
  trap (a plain LAST-wins fold silently agreeing with most-downstream-wins
  because of iteration order, only a rank-contradicting FIRST-wins fold
  actually catching it) is real: traced `compute-stage-map`'s
  `mapcat role-ticket-pairs-for roles` over `roles.tsv` order and confirmed
  last-pair-wins does coincide with rank order for every producible input —
  the recorded break (FIRST-wins) is the one that actually exercises the
  assertion, and the comment is correct to flag the obvious break as a false
  negative for the next person.
- **Neither property test is vacuous or missing** — both exist, both are
  non-trivial, both independently re-run green below. No
  `invariant-unencoded` item.
- **Mailbox-dir / batch-enumeration reuse, read by hand:** `role-ticket-pairs-for`
  now maps `[:new :in_process]` through the SAME `handoff-lib/mailbox-dir`
  resolver and the SAME `list-handoff-files-with-batches` used for the prior
  `:in_process`-only scan — confirmed by reading `mailbox-dir`/
  `mailbox-base-dir` (`handoff_lib.bb:262-278`): master-resident roles
  (specifier, coordinator) get their own per-role subdirectory regardless of
  state, every other role keeps its flat per-worktree layout regardless of
  state. No second re-derived path, no risk of a master-resident role's
  `new/` resolving to the wrong subdirectory. `ticket-id-from-headers`,
  `filter-active`, and the known-ticket-prefix allowlist are byte-unchanged
  (confirmed via the diff, not assumed).
- **Correctness read beyond the invariants:** traced the "both states, same
  role" case (a parcel that moved from `in_process/` to a batch role's own
  `new/` without the sender's `in_process/` file being cleared yet, or vice
  versa) — `reconcile-stage-map`'s tie-break makes this harmless (same role
  either way). Traced the cross-role transition case (open upstream, deliver
  downstream) — most-downstream-wins resolves to the downstream (more
  current) role, which is the whole point of the ticket. Both are exercised
  by the property test's `both-states-same-role` and
  `opened-then-delivered-downstream`/`delivered-then-opened-downstream`
  shapes with asserted reach floors (`>= 4`, `>= 6`), not left to chance.
- **Scenario Outline handler validates against explicit KNOWN_VALUES**
  (engineering.prompt requirement): `PARCEL_STATES` map in the step handler
  is exactly that, not a passthrough — confirmed.
- **Fixture hygiene:** `fs.mkdtempSync` fixture root removed in a `finally`
  in the step handler's `the board is rendered` step (not only after the
  last assertion) — BL-971 discipline followed. `aps-bl1048-` prefix matches
  `fixture_reaper_lib.bb`'s known-fixture-prefixes.
- **`required_stages`:** ticket lists `[coder, cleaner, architect, hardender,
  documenter, qa]` — architect is on the list, forwarding to hardender next
  is correct.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

Both invariants worth stating on the touched pure surface (`pipeline_stage_cli.bb`'s
`role-ticket-pairs-for`/`compute-stage-map`) are already the ticket's own two
declared invariants, covered above. No further round-trip/ordering/idempotence
candidate found on the touched module; nothing to add.

## Verification re-run live (not trusted from the commit message)

- `bash swarmforge/scripts/test/test_pipeline_stage_cli.sh` → **ALL CHECKS
  PASSED** (20 checks total, including the 8 new BL-1048 ones).
- `bb swarmforge/scripts/test/pipeline_stage_lib_test_runner.bb` → **ALL
  TESTS PASSED**.
- Stale build caught and fixed before trusting anything downstream of
  `extension/out/`: `extension/out/bridge/letsTalkGateScope.js` was missing
  entirely (last full compile predated this merge) — `npm run compile` run
  in `extension/` before re-running acceptance/property; clean compile, no
  errors.
- `node specs/pipeline/cli.js specs/features/BL-1048-a-delivered-parcel-is-not-not-started.feature`
  → **6/6**.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1048DeliveredParcelIsNotNotStarted.property.test.js` (from
  `extension/`) → **1/1 pass**.
- Consumer sweep re-run independently, not trusted from the evidence file:
  BL-464 → 5/5, BL-488 → 4/4, BL-489 → 3/3, BL-503 → 8/8 — all match the
  coder's claims exactly.
- The two claimed pre-existing reds re-confirmed independently: BL-487 → 2
  fail (unchanged), BL-814 → 3 fail (unchanged), both with the identical
  `java.io.FileNotFoundException` on `daemon_cycle_guard_lib.bb` the coder's
  evidence names. `backlog/paused/BL-973-stale-bb-copy-lists-and-ungated-red-test.yaml`
  confirmed to exist and cover exactly this — correctly left alone per
  BL-506.
- `extension/test/conciergeTick.test.js` → 111/111,
  `extension/test/readLiveRoleHeldTicketsCli.test.js` → 8/8 (119 total,
  matches the coder's claim exactly).

— By architect.
