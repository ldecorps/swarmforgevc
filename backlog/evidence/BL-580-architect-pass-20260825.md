# BL-580 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `d58677fcee` (on coder `bb166ecb36`) into
`swarmforge-architect`. Merged first; ancestry confirmed
(`git merge-base --is-ancestor d58677fcee HEAD`).

## Scope

Morning-briefing front-desk MECHANISM diagram allowlist slice only:

- `docs/diagrams/front-desk-flow.mmd` (new)
- `extension/src/tools/render-briefing-diagrams.ts` (`DIAGRAM_FILES` +1)
- `extension/test/renderBriefingDiagramsCli.test.js` (fixture + expected names)
- `specs/pipeline/steps/bl580FrontDeskMechanismBriefingDiagramSteps.js` (new)
- `specs/pipeline/steps/index.js` (register wiring)
- `backlog/evidence/BL-580-cleaner-pass-20260824.md`

Hitchhike gate on `bb166ecb3^..HEAD`: SCOPE_CLEAN (6 paths, all BL-580).

## Architecture

- Companion to BL-579: one `.mmd` + one explicit `DIAGRAM_FILES` entry
  `{ name: 'front-desk', file: 'front-desk-flow.mmd' }`. Allowlist remains
  an explicit table, not a directory scan.
- CLI tool stays on the existing shell-out boundary
  (`briefing_email_lib.bb` → `render-briefing-diagrams.js`); no webview,
  no browser storage, no secrets written to the target tree, no agent
  spawn from TypeScript to bypass tmux.
- Diagram documents CURRENT front-desk path (Telegram → bridge → restricted
  Operator `--tools ""` → outbox/SSE); out_of_scope forbids behaviour change.
- APS steps drive REAL `renderBriefingDiagrams` + `build-diagram-section`;
  no literal diagram count (BL-643/BL-1005), matching ticket notes.
- Integrate-not-fork: documents the maintained fork's front-desk path; does
  not copy or modify SwarmForge substrate.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

Parcel extension paths (cwd-relative to `extension/`):

    node extension/out/tools/dependency-gate.js \
      src/tools/render-briefing-diagrams.ts \
      test/renderBriefingDiagramsCli.test.js
    → PASSED: no forbidden edges.

## Co-change (`node extension/out/tools/co-change-report.js`)

Allowlist ↔ step registry / sibling CLI tests co-change as expected for
this slice shape (same pattern as BL-579). Advisory only; nothing warrants
a send-back.

## Invariants review (BL-633/BL-654)

Ticket declares no `invariants:`. Check is a no-op.

## Property-testing support (undeclared)

Touched production surface is an allowlist constant plus an async
file/IO render path — not a pure property-shaped module. No new
`*.property.test.js` authored this pass (would be vacuous).

## Correctness read-through

- Unit: `npx vitest run test/renderBriefingDiagramsCli.test.js` → **4/4**.
- Diagram source states the restricted-operator constraint; inbound/
  operator/outbound hops match the ticket's drafted mechanism (scripts
  remain source of truth for any later refine).
- No correctness defect spotted in the parcel under review.

## Prior bounce check

No BL-580 bounce evidence under `backlog/evidence/` (only cleaner-pass +
intake draft). Local `main` ahead of `origin/main` (278); neither tip
carries a prior QA bounce for this task.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-580-front-desk-mechanism-briefing-diagram`, commit = this evidence
commit (BL-536 / BL-806 — never the bare received hash).

By architect.
