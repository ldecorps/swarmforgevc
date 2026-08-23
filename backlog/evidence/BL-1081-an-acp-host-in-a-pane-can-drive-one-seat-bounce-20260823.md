# BL-1081-an-acp-host-in-a-pane-can-drive-one-seat — QA bounce — 20260823

Full Article 4.4 pass. Every gate below was actually run or is recorded
BLOCKED BY the item that stops it; this is the complete inventory, one
bounce.

## Gates run — all PASS except D1

- `cd extension && npm run compile`: clean.
- `cd extension && node scripts/recordTestDuration.js` (full unit suite):
  481 files / 8635 tests, all green (after restoring
  `extension/test/helpers/bl1071SweepFixture.js` during merge conflict
  resolution — see "Merge note" below; without it the suite fails 1 file on
  a missing-module load error, not a BL-1081 defect in itself, fixed before
  this pass).
- `cd extension && npm run test:properties`: 467/468 green. The one failure
  (`test/bl1012FreshnessSelfInflictedIncidents.property.test.js`, "generator
  reached only 4 uncapped states") is confirmed pre-existing and unrelated:
  `git diff fa2b43401..38baa603d7 -- extension/test/bl1012...` is empty (no
  commit in this parcel touches the file), and it passed cleanly re-run in
  isolation (`npx vitest run --config vitest.properties.config.mjs
  test/bl1012FreshnessSelfInflictedIncidents.property.test.js` — 3/3 green).
  Same shape as the BL-1071 bounce's own precedent for an unrelated flake —
  not raised as a defect here. Two `[vitest-worker]: Timeout calling
  "onTaskUpdate"` unhandled errors also appeared; exact match to the known
  benign artifact (engineering.prompt), allowlisted.
- Acceptance: `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1081-an-acp-host-in-a-pane-can-drive-one-seat.feature` —
  5/5 scenarios pass.
- `pgrep -fl 'node --test|stryker'` before and after every run: clean, no
  orphans.
- `required_wiring` anchor `specs/pipeline/steps/index.js::bl1081`:
  satisfied, registered and exercised by the acceptance run above.
- `required_wiring` anchor
  `swarmforge/scripts/babysitter_assess.bb::stop-reason`: the literal path
  is dead code (BL-781); the architect's own D1 bounce
  (`backlog/evidence/BL-1081-architect-bounce-20260823.md`) already caught
  this and the coder's fix correctly rewired the intent to the LIVE decision
  site instead — confirmed by reading the code:
  `swarmforge/scripts/babysitter_check.bb`'s `gather-role` (line ~238) calls
  `acp-session-lib/read-snapshot` and folds the result via
  `acp-session-lib/apply-acp-facts` into the per-role map passed to
  `babysitterd_sweep_lib.bb`'s `assemble-findings`, which calls
  `check-menu-blocked` / `check-busy-frozen` / `check-acp-seat` (all three
  confirmed present and wired at lines 526-533 of that file). Anchor intent
  satisfied at the correct site; no defect here.

## D1 — nothing in production ever spawns the ACP host for any seat; qa_e2e_procedure step 1 cannot be attempted (behavior, blame: coder)

The ticket's core ask is "Wire exactly one seat" — an actual running seat
(proposed: Mistral Vibe) driven through the ACP host in its own tmux pane.
`qa_e2e_procedure` step 1 requires launching a pack with that seat behind
the host and confirming the pane still renders a readable transcript.

Grepped for every production entry point that could construct or run the
host:

    grep -rn "acpHostRuntime\|AcpHostSession\|acp-native\|acpNative" \
      extension/src/swarm/swarmLauncher.ts extension/src/extension.ts
    # no hits

    grep -rln "AcpHostRuntime" extension/src/  # only the module's own file
    grep -rn "acp-native?" swarmforge/scripts/*.bb | grep -v /test/
    # only the defining file (prompt_engine_lib.bb) — zero callers anywhere
    # that would use the predicate to decide a launch

    find . -iname "*acp*cli*" -o -iname "*acp-host*"
    # only docs/spec/ticket files — no CLI entry point exists

The documenter's own pass (`backlog/evidence/BL-1081-documenter-pass-20260823.md`)
already states this plainly: "No production code spawns the host yet ...
This is a spike, still building toward its falsifiable E2E criteria
(qa_e2e_procedure on the ticket), not a completed feature" — and forwarded
it to QA anyway rather than back.

Every individual piece is real and independently correct (TS host/seat-state
modules, the babashka reader, the babysitter's live-site consumption, the
provider-table `:acp` dimension, the acceptance scenarios exercising the
decision logic via the shared sweep fixture) — but the piece that actually
launches a real seat behind the host does not exist anywhere. This is the
BL-149 shape named in the QA role prompt: correct and green in isolation,
invoked by nothing in the live swarm. Consequence: invariant 1 ("Seat
control decisions for the spiked seat consume structured session signals...
never pane-tail heuristics alone") does not hold for any real seat today —
`read-snapshot` will always return nil for a live role because no process
ever writes `.swarmforge/acp/<role>.json`. qa_e2e_procedure steps 1-4 (which
all depend on a live launch) cannot be attempted at all, so this cannot be
recorded as the falsifiable spike's "reject for our control model" verdict
either — that verdict requires actually trying the live control channel and
having it fail; here it was never tried.

## Failing command / commit / class (fields 1-2 for D1; no single command reproduces an absence)

1. Failing check: `grep -rn "acpHostRuntime\|AcpHostSession" extension/src/swarm/swarmLauncher.ts extension/src/extension.ts` (expect a construction site, found none) plus `grep -rn "acp-native?" swarmforge/scripts/*.bb | grep -v /test/` (expect a launch-deciding caller, found none).
2. Commit hash: `1f31cff91` (this QA worktree's merge of documenter's `38baa603d7` into swarmforge-QA).
3. First error excerpt: N/A — this is an absence, not a stack trace. The greps above return no matches outside the module's own file and its tests.
4. Failure class: `behavior` (the shipped code does not do what the ticket requires: drive a real seat through the host).
5. Expected vs observed: Expected a real launch-time decision site (in `swarmLauncher.ts` or an equivalent bb launcher) that, for the one wired seat, spawns `AcpHostSession`/runs the compiled host instead of the ordinary pane command. Observed: no such site exists; `AcpHostRuntime`/`acp-native?` have zero production callers.

## Remediation pointer

`extension/src/swarm/swarmLauncher.ts` (or wherever the pane launch command
is actually assembled for a role) needs a branch, gated on
`prompt_engine_lib.bb`'s new `:acp` capability (or its TS-side equivalent) for
the one chosen seat, that runs the compiled ACP host
(`extension/out/swarm/acpHostRuntime.js`) as the pane's process instead of the
ordinary agent CLI invocation — and an acceptance/property scenario that
actually exercises that launch decision, not only the deterministic-layer
logic given an already-written snapshot file.

## Merge note (not a defect — process record)

This parcel's merge into QA also touched files shared with BL-1071 (already
QA-bounced 20260823, evidence
`backlog/evidence/BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix-bounce-20260823.md`,
now correctly parked in `backlog/hold/` by a separate human decision).
Conflict resolution kept only BL-1081's own additions in
`specs/pipeline/steps/index.js` and
`swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`, excluding
BL-1071's still-bounced feature content. `extension/test/helpers/bl1071SweepFixture.js`
was restored from the incoming commit despite its name, because BL-1081's
own step handler (`specs/pipeline/steps/bl1081AcpHostDrivesOneSeatSteps.js:56`)
requires it as shared, ticket-agnostic sweep-testing infrastructure — it
carries none of BL-1071's disputed `strayHangs()`/`:unavailable` logic
(confirmed by reading the file). Recorded here so a future re-verification
of this ticket does not need to re-derive it.
