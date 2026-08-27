# BL-584 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Cleaner tip `e934f4e40e` (cherry-pick of hitchhike-free coder surface onto
`origin/main`). Architect **recreated** `swarmforge-architect` on this tip.

Hitchhike gate → CLEAN (13 paths).

## Architecture

Matches the approved design:

- Sweep lives in the front-desk concierge tick (injected
  `sweepStaleApprovalAsks`), not the VS Code host; Resend key from
  `process.env` (no `secrets.ts` / vscode).
- Pure module: clock from topic outbound locator + inbound human activity;
  fail-closed when ask post ts unknown; digest oldest-first; deep-link
  degrades without suppressing the send.
- `APPROVAL_ASK_LOCATOR` shared with ask composition; effective conf reader
  for pack timing + tracked email keys; cooldown via existing
  `decideNotifyAction` (write-before-send matches BL-073 anti-storm).
- Declared invariant encoded in
  `bl584StaleApprovalEscalation.property.test.js`.

## Gates

| Gate | Result |
|---|---|
| Compile | OK |
| Unit (escalation + config + conciergeTick) | **132/132** |
| Property | **1/1** |
| Acceptance (BL-584) | **20/20** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `hardender`, priority `00`, task
`BL-584-stale-approval-ask-email-escalation`.

Hardender (and later roles): recreate the role branch on this tip; do not
merge into hitchhiked ancestry.

By architect.
