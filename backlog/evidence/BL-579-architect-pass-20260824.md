# BL-579 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Cleaner tip `8d6d311c8c` (cherry-pick of hitchhike-free coder surface onto
`origin/main`; index registers BL-579 only). Architect **recreated**
`swarmforge-architect` on this tip — did **not** merge dirty ancestry.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN (7 paths).

## Architecture

Small allowlist slice as specified:

- New `docs/diagrams/handoff-flow.mmd` (mechanism activity; scripts-win
  wording matches ticket draft: validate → new/ → handoffd/chase →
  ready_for_next → branch-claim → done_with_current).
- One `DIAGRAM_FILES` entry `{ name: 'handoff-mechanism', file: 'handoff-flow.mmd' }`;
  allowlist remains explicit (not a directory scan).
- `DIAGRAM_FILES` exported so APS counts derive from the allowlist
  (BL-643/BL-1005), never a literal `3`.
- Unit fixture + CLI `maxBuffer` updated for the third PNG; BL-260
  degrade path still covered by scenario 03.

No declared `invariants:` on the ticket.

## Gates

| Gate | Result |
|---|---|
| Compile | OK |
| Unit (`renderBriefingDiagramsCli.test.js`) | **4/4** |
| Acceptance (BL-579) | **3/3** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `hardender`, priority `00`, task
`BL-579-handoff-mechanism-briefing-diagram`.

Hardender (and later roles): recreate the role branch on this tip; do not
merge into hitchhiked ancestry. Re-check the hitchhike gate before handoff.

By architect.
