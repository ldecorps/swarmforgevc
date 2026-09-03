# BL-1356 — LAND_ESCALATE, 20260903

QA-approved commit `ef1307af6f` (full independent verification below)
could not land.

## Verification performed before attempting to land (all PASS)

- Unit suite (`npm test`, extension): 576/591 files, 9924/9949 tests pass.
  15 failed files / 25 failed tests — the same standing-red lineage
  reported unrelated by prior QA passes (BL-1334, BL-1297, BL-1244:
  pilotAcceptanceGate `checkOrphanedAuthoredDocs is not a function`,
  tempDirTrapGuard, socketFixtureShortRootGuard, liveRepoDerivationGuard,
  operatorRuntimeBbFixtureClosure, telegramClient,
  telegramCursorOperatorExec, constitutionDocCitations, etc.). None of the
  15 files intersect `git diff origin/main HEAD --name-only`.
- Property lane (`npm run test:properties`, 185s): stamp-off family
  (bl1113/1115/1116/1117/1136/1323) all green (6 files, 12 tests). 19
  files failed overall; ran `ps_suite_extract_failing_files` +
  `ps_allowlist_file_is_allowlisted` — all 19 already allowlisted, ZERO
  stamp-off file among them (qa_e2e steps 2-3, satisfied). One
  BL-871-allowlisted `[vitest-worker]: Timeout calling "onTaskUpdate"`
  unhandled error, the sole allowed exception.
- `property_suite_standing_allowlist.tsv`: confirmed bl1113/1115/1116/
  1117/1136 rows are gone (qa_e2e step 3).
- Acceptance: `run_acceptance.sh specs/features/BL-1356-….feature` — 6/6.
- Non-weakening spot check (qa_e2e step 4), independent of the coder/
  hardener's own property proof: scratch-fixture run of
  `assertRunWritesNoDecision` with a mid-run write of `state: certified`
  + `human_decision` — still throws, as required.
- `git status --short backlog/hotfix-ledger.yaml`: clean throughout every
  run (qa_e2e step 5).
- `required_wiring` confirmed: `bl1356StampOffWatchesTheRunSteps`
  registered in `specs/pipeline/steps/index.js`.
- Reaped one straggler property-lane process group
  (`kill -- -<pgid>`) that outlived its run before re-checking for
  orphans — none remained afterward.
- Ancestry: `git merge-base --is-ancestor <hardener-merge> ef1307af6f` —
  OK.

## `land_step_cli.bb`

`bb swarmforge/scripts/land_step_cli.bb
BL-1356-stamp-off-invariant-watches-the-run-not-the-row ef1307af6f .`
returned `LAND_ESCALATE`:

    land-step: refusing to replay BL-1356 - specs/pipeline/steps/index.js
    is shared with unlanded sibling(s)
    BL-1296,BL-1309,BL-1328,BL-1337,BL-1346,BL-1351,BL-1354, and a
    replayed path is taken whole, so landing it would carry the sibling's
    lines into main (BL-1332)

## Diagnosed per-sibling, same method as BL-1354's own land-success note

Checked each named sibling's own `require(...)` line in
`specs/pipeline/steps/index.js` against `origin/main` directly
(`git show origin/main:specs/pipeline/steps/index.js`):

- **BL-1328, BL-1337, BL-1346, BL-1351, BL-1354**: each already has its
  line on `origin/main`, byte-identical. FALSE POSITIVES — the known
  BL-1354-fix-is-per-ticket-not-per-path gap (a landed sibling's overall
  verdict still reads unlanded because of trailing, never-pushed
  bookkeeping commits in this worktree — land-success evidence files,
  `active/` → `done/` ticket-yaml renames — not because of the shared
  file itself).
- **BL-1296, BL-1309**: genuinely have NO line on `origin/main` yet.
  Checked both tickets' own status: both `status: blocked`,
  `human_approval: pending` (BL-1296 the bubble-seat ticket; BL-1309 the
  land-decide-entanglement ticket — the very detector this land step now
  runs). Neither is landable — this is a real, current entanglement:
  `specs/pipeline/steps/index.js` on this tip carries their unlanded
  require lines alongside BL-1356's own, and the replay takes the file
  whole.

## Bounded rematch (BL-1144 discipline)

`git fetch origin main` before AND after the first `--decide-only` /
`land_step_cli.bb` attempts — no new commits either time, so the escalate
is not a race; it is a genuine standing entanglement pending human
approval on two other tickets.

## Disposition

Not a bounce (nothing failed in BL-1356's own domain — every gate above
passed). Not landable by hand-replay either: BL-1296's and BL-1309's
require lines cannot be dropped from a whole-file replay without altering
content genuinely on this tip that is neither BL-1356's nor mine to
discard, and they cannot be landed first (both blocked on human ruling).

Sent the specifier a `note` (priority `00`) naming the conflicting paths
and the two blocking tickets. QA approval **stands** — this parcel is
complete and correct; landing is deferred pending BL-1296/BL-1309's own
human rulings, per QA role prompt's BL-1241 remedy step 3. Not re-entering
any earlier stage.
