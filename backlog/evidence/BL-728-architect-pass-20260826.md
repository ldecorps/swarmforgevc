# BL-728 — architect pass — 20260826

- merge_and_process cleaner tip `a1176ff144` (clean merge).
- Ticket: verify handoffd deliver! / one-shot flag bug independently of BL-636
  commit-message claims; evidence + regression lock (+ fix if still broken).

## Architecture / boundaries

- Verification slice is Babashka/shell + APS acceptance only — no extension
  production surface, no webview/host boundary changes, no tmux bypass.
- `test_handoffd_one_shot_flags_parse.sh` and APS steps spawn `bb` from
  fixture roots with `SWARMFORGE_ALLOW_TMP_DAEMON=1` (same discipline as other
  `test_handoffd_*_wiring.sh` lanes).
- Dependency gate (`test/residentSpyUiHtml.test.js`): **PASSED** — merge-conflict
  resolution only (restored BL-1153 font-reload test alongside BL-1046 tile
  assertions); no forbidden edges.
- Co-change on `residentSpyUiHtml.test.js`: expected historical resident-spy
  UI coupling; BL-728 core paths (`bl728HandoffdDeliverParenVerificationSteps.js`,
  wiring shell) co-change only with their feature/evidence — no new logical
  coupling introduced by verification work.

## Out-of-ticket merge artifact (BL-506 note)

- `extension/test/residentSpyUiHtml.test.js` adds BL-1153 reload test restored
  during cleaner merge conflict — ticket BL-1153, not BL-728 core. Architecturally
  clean; restores work dropped in BL-1046 conflict resolution.

## Required wiring

- APS `bl728HandoffdDeliverParenVerificationSteps` registered in index; all seven
  feature scenarios bind to registered handlers (BL-753: no orphan handlers).

## Invariants

1. **Verification independent of BL-636 message** — encoded by APS scenario 04
   (`git diff 6a2e4aaf6` excludes `deliver!`; evidence names `536c16ffb` /
   `5f9a79511` and states bug fixed). Process invariant; no fast-check module —
   acceptance + evidence are the executable encoding.
2. **Fix if broken, not evidence-only** — encoded by APS scenario 05 (probes all
   one-shot flags; vacuous path requires evidence stating fixed; repair path
   demands wiring green + repair commit in evidence). Non-vacuous: scenario 05
   fails if flags break and evidence claims fixed without repair.

## Property-testing pass (undeclared TS modules)

- No touched TypeScript pure production modules; Babashka/shell verification only.
  No new `*.property.test.js` added.

## Verification

- `test_handoffd_one_shot_flags_parse.sh`: ALL PASS.
- `run_acceptance.sh BL-728-handoffd-deliver-paren-verification.feature`: 7/7 green.
- No prior QA bounce for BL-728 on main.

Pass → hardender.

By architect.
