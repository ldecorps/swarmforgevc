# BL-758 — architect pass — 20260826

- merge_and_process cleaner tip `78f6595dd7` (clean merge).
- Ticket: /pilot per-hat reinject of live `swarmforge/roles/<role>.prompt`
  (+ thin wrapper / pack overlay); stage verdicts record path+sha256; land
  refuses `pilot-hat-prompt-missing` when evidence absent (inert); fail-open
  warning if expedite tree unreadable.

## Architecture / boundaries

- Pure assessor in `perHatRolePromptEvidenceCheck.ts`; expedite FS IO in
  `commitClaimGitReader.ts`; refuse + warning in `pilotAcceptanceGate.ts`;
  CLI wiring in `pilot-acceptance-gate.ts`; compose in
  `telegramCursorBridgePilot.ts` (`composePilotStagePrompt` + start-path
  guidance).
- dependency-gate on parcel sources: **PASSED**.
- co-change: expected land-gate / pilot-prompt coupling (informative).

## Required wiring

- `composePilotStagePrompt` loads live role prompt + thin wrapper.
- `composePilotExpeditorPrompt` requires per-hat reinject, not mega-brief-alone.
- `checkPerHatRolePromptEvidence` called from `landPilotedTicket` before move.
- CLI supplies real check; APS `bl758…` registered in index.

## Invariants

1–2. Stage compose + isolation wrapper: APS per-hat-01/02/06 + unit tests on
   `composePilotStagePrompt` / expeditor prompt (static prompt shape).
3. Verdict path+sha256 or refuse: encoded in
   `perHatRolePromptEvidenceCheck.property.test.js` (+ non-vacuity); inert land
   refuse covered.

## Verification

- `node --test` perHatRolePromptEvidenceCheck: 4/4; telegramCursorBridgePilot: 20/20.
- vitest properties: 4/4.
- No prior QA bounce for BL-758 on main (specifier-only history).

Pass → hardender.

By architect.
