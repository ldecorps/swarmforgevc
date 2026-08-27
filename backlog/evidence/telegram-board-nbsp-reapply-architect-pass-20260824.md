# telegram-board-nbsp-reapply — architect pass (bounce re-fix), inventory NONE — 20260824

Reviewed cleaner `d61e594d93` (batch tip including coder bounce clear
`39435d8721` on board restore `a966f07948` + Spec/done narrative from
`e2bbe4d6e4`) into `swarmforge-architect`. Merged cleanly; ancestry
confirmed. Prior architect bounce `66fdf8eb52` remains in lineage.

## Bounce context (Article 4.4 / BL-340)

Architect bounce
`backlog/evidence/telegram-board-nbsp-reapply-architect-bounce-20260824.md`
named D1–D2 — Spec and done YAML still claiming `&#160;` while HOTFIX_PATHS
emit `&nbsp;`. QA D1–D2 of the earlier QA bounce were already green on the
first architect pass of the restore tip.

## Bounce clearance this pass

| Item | Check | Result |
|---|---|---|
| Architect D1 | Spec `escapeHtml` named-entity wording | `&nbsp;` (no `&#160;`) |
| Architect D2 | done YAML narrative / vitest claim | `&nbsp;` (no `&#160;`) |
| QA D1 | Feature Then-line + BL-1113 board Outline | 9/9 green |
| QA D2 | `pipelineBoard.ts` == `27273f2b0a`; properties 2/2 | OK |
| Pack | `cursor-forge.conf` == `27273f2b0a` | MATCH |
| Dep-gate / board unit | PASSED / 127/127 | OK |

## Architecture

Restore-only parcel: re-align stamped board/feature/docs narrative with
certified `&nbsp;` HOTFIX_PATHS. No new production module, no webview/host
boundary change, no SwarmForge fork. Spec bulk line-count drift vs
`27273f2b0a` is other landed prose; the bounce surface (escapeHtml entity
claim) matches the stamped behavior.

## Required hard gate

`node extension/out/tools/dependency-gate.js src/concierge/pipelineBoard.ts
test/pipelineBoard.test.js` → PASSED.

## Invariants / properties

No new declared invariants on this restore task. BL-1113 stamp-off
properties 2/2 green (blob identity + ledger pending). No undeclared
property gap authored.

## Correctness read-through

Board blob identity with `27273f2b0a`; acceptance 9/9; board unit 127/127.
Prior bounce inventory fully cleared.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`telegram-board-nbsp-reapply`, commit = this evidence commit
(BL-536 / BL-806).

By architect.
