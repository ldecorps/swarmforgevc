# BL-1296 — QA re-verification and land, 2026-09-04

## Context

Resumed via specifier `note` (priority `00`, in_process at session start):
"BL-1296 approval stands. Blocker is BL-1371, not your parcel. See
evidence." This confirms `backlog/evidence/BL-1296-land-escalate-20260903.md`'s
own disposition: the prior QA pass (2026-09-03) fully verified and approved
BL-1296's own work, and escalated ONLY the landing mechanism — the shared
`specs/pipeline/steps/index.js` needed BL-1309/BL-1356/BL-1359's own step
handlers present too, under the (then-current) hand-maintained-array
registration scheme. `BL-1385`'s adjudication (`backlog/evidence/BL-1296-
orphan-handler-crashes-discovery-20260904.md`, this session) independently
confirms the same disposition: "The immediate repair is QA's and is already
asked for by note (land BL-1296, which is approved and waiting)."

BL-1371 (directory-discovery registration, replacing the hand-maintained
array) landed 2026-09-03 16:57 BST, per this session's own prior BL-1377/
BL-1378 lands. The blocker no longer exists: a new handler file registers
itself by presence, no shared-file edit required.

## Re-verification (own domain)

BL-1296's own code has not changed since the prior QA pass; re-ran rather
than trusted, since a day and several intervening lands have passed:

- `npm run compile` — clean.
- `npx vitest run bubbleSeat.test.js bl1296BubbleSeatLive.test.js
  bl1296BubbleSeatTurn.test.js` — 28/28 pass (3 files).
- `npx vitest run --config vitest.properties.config.mjs
  bl1296BubbleSeatInvariants` — 5/5 pass.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1296-bubble-answers-from-its-own-seat.feature` — 6/6
  pass, matching the prior pass's evidence.
- `extension/src/tools/bubbleSeat.ts` / `bubbleSeatLive.ts` present and
  compiled to `extension/out/tools/` in this worktree.
- `bounce_history`: one prior architect bounce (`500e6826c4`), already
  reworked; not still open.
- Ruling legitimacy: `human_ruling: "Strict echo (option 1)..."` — a
  substantive, non-templated ruling with its own rationale, already
  verified genuine by the prior QA pass and unchanged since.

## Landing

`bb swarmforge/scripts/land_step_cli.bb BL-1296-bubble-answers-from-its-own-seat
<HEAD>` now returns `LAND_REPLAY` (not `LAND_ESCALATE`) — confirms the
BL-1371 blocker is gone: no `missing registry module` refusal from
`check_feature_handler_registration.sh` this time.

Same standing over-inclusion class as every land this session (BL-1376/
BL-1377/BL-1378's own evidence): the automated replay's 29-file diff
against `origin/main` included two other tickets' own `backlog/done/*.yaml`,
one unrelated INTAKE file, three other tickets' own `docs/how-to/*.md`
edits, one unrelated generated briefing file, and `docs/index.md`/
`Specification.MD` stacking two other tickets' (BL-1367, BL-1360) entries
alongside BL-1296's own. `specs/pipeline/steps/bl1296BubbleSeatSteps.js`
needed no extraction — already on `origin/main` (pre-landed as orphan
scaffolding by `a93aa4a18f`, the very commit whose gap BL-1385 now guards
against).

Hand-built tip-pure commit: 20 files (9 evidence + this evidence file +
how-to page + ticket YAML append + 3 source `.ts` + 5 test files + feature
file stub-extension) + 2 line-level splices (`docs/index.md`: one link,
inserted after the BL-1235 line; `docs/reference/Specification.MD`:
prepended BL-1296's own entry, excluding BL-1367's and BL-1360's stacked
below it). No `suite-manifest.tsv` entry needed — this ticket's tests run
under `vitest`, not the `.bb`/shell standing-suite manifest.

Full landed-commit accounting recorded in `BL-1296-land-success-20260904.md`.

By QA.
