# BL-1189 architect pass (bounce re-fix) — 2026-08-27

## Reviewed commit

`739ca994e` ("fix(BL-1189): reinstate dedupePrimaryWorkingTicket, fix leaked
fixture dir"), merged into architect via cleaner's `feb2fdd504`.

## Re-fix closes both outstanding items from the resend bounce

`BL-1189-architect-bounce-resend-20260827.md` held two items open: D1
(leaked `mkdtempSync` fixture dir) and D-NEW (`required_wiring` gap —
`isTicketActive` / `dedupePrimaryWorkingTicket` missing after the
BL-490/BL-495 entangled-batch revert never got a re-fix back through the
pipeline). Both verified fixed:

- **D-NEW**: `isTicketActive` (gates `resolveResidentHeldTicketMeta` on
  `backlog/active/` membership) and `dedupePrimaryWorkingTicket` (shared
  `Set` threaded through `tryCaptureRolePane`/`captureLiveScreenPanes`) are
  both back in `residentPaneSpy.ts`/`residentPaneLive.ts`, byte-identical to
  the originally-reviewed `e8e14057e` diff. All three `required_wiring`
  entries verified present: `resolveResidentHeldTicketMeta` (gate confirmed
  in source), `tryCaptureRolePane` (confirmed threads `claimedTicketIds`),
  `specs/pipeline/steps/index.js` line 817 (`bl1189LiveScreenOnePrimaryWorkingTicketSteps`
  registered).
- **D1**: `cleanupFixture(ctx)` now wired in a `finally` at both of the
  file's true terminal fixture-touching steps ("builds all role tile
  payloads" and "runs twice within one capture TTL") — the only two steps
  that call `captureAllTiles`, and every one of the feature's 5 scenarios
  ends in one of them (checked the feature file directly). Verified: 15
  pre-existing `/tmp/bl1189-aps-*` dirs from before this fix; ran the full
  acceptance suite (`node specs/pipeline/cli.js
  specs/features/BL-1189-live-screen-one-primary-working-ticket.feature`,
  5/5 pass) and the count stayed at 15 — zero new leaks.

## Verification run fresh this pass (not trusting the commit message)

- `npm run compile` (extension) — clean.
- `node out/tools/dependency-gate.js src/bridge/residentPaneLive.ts
  src/concierge/residentPaneSpy.ts` (run from `extension/`) — PASSED, no
  forbidden edges.
- `node out/tools/co-change-report.js` on the three changed non-test
  files — coupling signal matches the diff's own footprint
  (`residentSpyUiHtml.ts`, both `.test.js` siblings,
  `specs/pipeline/steps/index.js`); nothing unexpected.
- `npx vitest run --config vitest.config.mjs test/residentPaneSpy.test.js
  test/residentPaneLive.test.js` — 22/22 and 19/19 green.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`
  — 4/4 green (both declared invariants remain property-encoded and
  non-vacuous, per the original pass's break-then-fix check — logic
  unchanged from the originally-reviewed diff).
- Full acceptance run via `specs/pipeline/cli.js` — 5/5 scenarios pass.
- Two-layer boundary / host-owns-I/O: only `extension/src/{bridge,concierge}/`
  files touched (host side); no webview file, no browser storage, no
  secrets in this diff.

## Property testing pass

No new property-shaped pure module beyond what the ticket's own declared
invariants already require (covered above). `dedupePrimaryWorkingTicket`
itself is simple pure logic already covered by three targeted unit tests
(first-claim-wins, distinct tickets, no-mutation-on-empty-meta) plus the
declared-invariant property file exercising it end-to-end; no
additional property test warranted.

## Note (non-blocking, out of this parcel)

`backlog/paused/BL-1189-live-screen-one-primary-working-ticket.yaml` is a
stale duplicate of the now-active `backlog/active/` copy (both landed via
the session's `08ed89db8`/`699e883f8` re-land-onto-main recovery commits).
Same pattern present for BL-1188. Grepped `backlog/` for an existing ticket
covering stale paused/active duplicate cleanup and found none — flagging
for specifier/coordinator awareness, not blocking this pass (backlog file
hygiene, not this ticket's architecture).

## Disposition

Architecturally compliant, correctness confirmed, both invariants intact
and property-encoded. Forwarded to **hardender**, same task name, commit
`739ca994e` (post-merge tip on architect after `feb2fdd504`).
