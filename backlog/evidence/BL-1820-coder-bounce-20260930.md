# BL-1820 — coder bounce fix, 2026-09-30

Rebuilds the reverted BL-1820 feature (the specifier battery grades
judgment skills) with QA's two defects fixed
(`backlog/evidence/BL-1820-QA-20260930.md`):

## D1 — reality-check passed any FILE

`grade_reality_check` accepted any non-NONE token as the cited FILE
(`FILE: banana` passed). Fixed by requiring FILE to equal
`REALITY_CHECK_CLAIMED_FILE` (`extension/src/swarm/roleParser.ts`, the
prompt's own claimed path), never merely "not NONE".

## D2 — invest-split had no refusal path

The ticket's own contract is "two or more tickets OR a refusal that asks
to split", but `grade_invest_split` only ever accepted a `TICKETS: <n>`
line - no refusal shape could pass at all. Fixed by offering a second
structured answer shape in the prompt itself (`REFUSE-SPLIT`, a literal
line) and accepting it in the grader, alongside the existing `TICKETS: <n>
>= 2` path.

## Regression coverage

- `swarmforge/scripts/test/test_local_specifier_battery.sh`: two new
  cases (14c: `REFUSE-SPLIT` passes; 18d: `FILE: banana` with a valid
  verdict fails) - 30/30 ALL PASS.
- `specs/features/BL-1820-...feature`: two new Examples rows matching
  the same two cases, driven through the real step handler's
  KNOWN_VALUES lookup (never a passthrough).
- Reproduced both of QA's own failing commands directly against the
  fixed grader: D1's `FILE: banana` now fails; D2's own structured
  `REFUSE-SPLIT` shape now passes (QA's illustrative free-text "REFUSE:
  ..." was never meant to be the exact accepted string - the remediation
  pointer asked for a NEW structured shape, which the updated prompt now
  offers).

## Verification

- `node specs/pipeline/cli.js specs/features/BL-1820-the-specifier-battery-grades-judgment-skills.feature`:
  13 of 13 ok.
- `bash swarmforge/scripts/test/test_local_specifier_battery.sh`: ALL PASS
  (30 checks).
- `cd extension && npm test`: 640 files, all pass.
- `cd extension && npm run test:properties`: 479 files; one file
  (`selfHealTelemetry.property.test.js`) showed a transient TOCTOU race
  against a sibling process's scratch file under concurrent full-lane
  forks - confirmed unrelated to this parcel and non-reproducing in
  isolation (re-ran alone: 7/7 pass). No standing-red row exists for it;
  not owned by this ticket.

By coder.
