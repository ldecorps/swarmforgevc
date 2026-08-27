# BL-1113 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `7feca3dd70` (evidence-only tip on coder `46a9cf02ad`)
into `swarmforge-architect`. Merged first; ancestry confirmed
(`git merge-base --is-ancestor 7feca3dd70 HEAD`).

## Scope

Stamp-off harness only — confirms or refutes landed Cursor hotfix
`27273f2b0a`; does not rewrite it:

- `specs/pipeline/steps/bl1113CursorHotfixStampOffSteps.js` (new)
- `specs/pipeline/steps/index.js` (register wiring)
- `extension/test/bl1113CursorHotfixStampOff.property.test.js` (new)
- `backlog/evidence/BL-1113-cleaner-pass-20260824.md`

No production rewrite of the six hotfix paths. Working-tree blobs still
match `27273f2b0a` for all six (`git diff --quiet` each). Ledger row for
`27273f2b0a` remains `state: pending` / `human_decision: null`.

## Architecture

- APS steps drive the REAL landed APIs (`master_main_reconcile_lib`
  sync-action / deadlock helpers, `cursor-forge.conf`, compiled
  `pipelineBoard` + `telegramCursorOperatorCore` /
  `telegramCursorBridgeLive`) — no reimplementation of hotfix behaviour.
- Extension-host tools own plan-confirm I/O; no webview storage; no
  browser `localStorage`/`sessionStorage` on the reviewed hotfix modules.
- Pipeline Board remains pure presentation helpers in the host concierge
  layer; CreatePlan Confirm/Reject stays on the Telegram Cursor Remote
  host path — no agent spawn from TypeScript to bypass tmux.
- Integrate-not-fork: stamp-off reviews the maintained fork's landed
  scripts/pack; does not copy or fork SwarmForge.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

Parcel extension file alone:

    node extension/out/tools/dependency-gate.js \
      test/bl1113CursorHotfixStampOff.property.test.js
    → PASSED: no forbidden edges.

Scanning the APS step module (which requires the Telegram operator
compiled surfaces) surfaces the standing `acyclic` cycle among
`telegram-front-desk-bot` ↔ `telegramCursorOperator{Exec,Liveness}` —
identical edges already tracked as **BL-759** (`backlog/paused/BL-759-…`,
grepped this pass). None of this parcel's files introduce or edit either
side of that cycle. Out-of-parcel standing debt; not a bounce.

## Co-change (`node extension/out/tools/co-change-report.js`)

Parcel trio co-changes with each other as expected. `specs/pipeline/steps/index.js`
shows high historical coupling to many swarm files (step-registry habit) —
pre-existing, not introduced by this stamp-off. Tool is advisory only;
nothing warrants a send-back.

## Invariants review (BL-633/BL-654) — 2 declared, both encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Stamp-off never reimplements the hotfix — review confirms/refutes `27273f2b0a` only | `bl1113CursorHotfixStampOff.property.test.js` (blob identity over HOTFIX_PATHS) | Ran green (`npm run test:properties -- test/bl1113CursorHotfixStampOff.property.test.js`). Manual `git diff --quiet 27273f2b0a -- <path>` OK on all six paths. |
| 2 | Green tests alone never write certified/waived into the hotfix ledger | Same property file (ledger `state`/`human_decision` stay pending/null) | Ran green. Live ledger slice matches. |

Coder non-vacuity claim recorded in the property file header (break blob
compare / assert certified → RED). No missing or vacuous encoding found.
Failure class `invariant-unencoded` does not apply.

## Property-testing support (undeclared)

Parcel introduces no additional undeclared property-shaped pure production
module beyond the two declared invariants already encoded by the coder.
No new `*.property.test.js` authored this pass — manufacturing one would
be vacuous. Declared suite green (2/2).

## Correctness read-through

- Acceptance feature 9/9 green via `node specs/pipeline/cli.js …BL-1113…`.
- Step Examples tables lock sync-action and slug rows; deadlock scenario
  asserts trip-once + handoffd suppress markers without rewriting libs.
- No correctness defect spotted in the parcel under review. Ledger
  certification remains a human decision (out of scope for this stage).

## Prior bounce check

No BL-1113 bounce evidence under `backlog/evidence/`. Local `main` is
ahead of `origin/main` (expected for this uncertified hotfix lineage per
ticket notes); no prior QA bounce for this task on either tip.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off`, commit = this
evidence commit (BL-536 / BL-806 — never the bare received hash).

By architect.
