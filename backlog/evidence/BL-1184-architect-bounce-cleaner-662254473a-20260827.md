# BL-1184 — architect bounce — cleaner 662254473a — 20260827

**Received:** `merge_and_process cleaner 662254473a` (handoff
`00_20260827T124115Z_000008_from_cleaner_to_architect`)
**Reviewed:** cleaner `662254473a`
**Task:** BL-1184-briefing-shift-velocity

## Verdict

**Bounce → coder.** Core metrics architecture OK; APS **5/6** — telemetry
scenario outline example [1] fails on repeat runs.

## Architecture (not bounce items)

| Check | Result |
|-------|--------|
| Dependency gate | **PASSED** on shiftVelocity*, render tool |
| Invariant: done/ only | `buildShiftVelocityHistoryFromGitEntries` → `deriveIntakeBalanceEvents` |
| Invariant: no second reader | Adapter name pinned in history + APS step |
| Invariant: non-linear axis | `nonLinearTimePositions` + property helpers; APS 4/4 on axis scenario |
| required_wiring | Steps registered; git adapter + optional telemetry path |
| Unit | `shiftVelocity.test.js` 4/4 |
| Tip purity | 7-file BL-1184 slice only |

## Inventory

### D1 — `acceptance` (blame: coder)

**Repro:**
```
specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1184-briefing-shift-velocity.feature
```
→ example [1] of outline `forward capture uses telemetry when required` fails at
`Then an append-only shift-velocity log is created`: `recording.created` is
**false** (file already exists).

**Cause:** `bl1184BriefingShiftVelocitySteps.js` calls
`configureShiftVelocityRecording('/tmp/bl1184-fixture', …)` — fixed path leaves
`.swarmforge/telemetry/shift-velocity.jsonl` on disk; second APS run (or prior
parcel run) makes `created` false.

**Remediation:** Use `fs.mkdtempSync` per scenario (or delete fixture tree in
Background/`no existing landed-window telemetry` step) so example [1] is
idempotent. Re-run APS **6/6**.

## Forward

Bounce to **coder** — do not forward to hardender until APS green.

By architect.
