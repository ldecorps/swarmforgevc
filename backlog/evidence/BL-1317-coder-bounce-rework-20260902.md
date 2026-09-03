# BL-1317 — coder rework after QA bounce D1 (20260902)

Inbound: QA `1025f6e82b` (reverse hop, `non-forwarding: true`), carrying
`backlog/evidence/BL-1317-qa-bounce-20260902.md`.

## D1 — "`decideAdaptEffort` has zero live callers"

Confirmed as stated. QA offered two remedies and left the choice to coder.
Investigated both; they are not equivalent.

**Why a TypeScript-side automatic caller is not addable.** The live Adapt
consumer is `swarmforge/scripts/handoff_lib.bb::record-effort-adapt!`, wired
at `done_with_current_task.bb`. It is a complete applier: it writes the
seat's `.swarmforge/launch/<role>.claude-settings.json` `effortLevel`
itself, and its climb survives the ticket's re-claim via
`seat_difficulty_lib.bb::claim-effort-decision`'s `climbed` branch
(lines 173-197). `adaptRoleEffort` writes that SAME file through
`switchRoleEffort`. Wiring any automatic TypeScript reaction to the same
outcome signal (e.g. `bounceWatcher.ts`) would therefore apply Adapt TWICE
for one bounce — climbing two notches where invariant 2 declares one. The
missing caller is not an oversight to fill; it is forbidden by the ticket's
own invariant.

**What was done instead (coder-owned, both parts).**

1. The self-contradiction QA actually found ON FILE is fixed:
   `extension/src/tools/effortDialAdapt.ts`'s header no longer claims "Any
   UI or launch path that wants Adapt calls this". It now states plainly
   that the bb consumer is the live applier, that this edge has no
   automatic caller by design, why (double-climb), and that the edge is
   reserved for an OPERATOR-DRIVEN surface (BL-236's manual dial being the
   shape).

2. That constraint is made a gate, not a comment —
   `extension/test/bl1317AdaptSingleApplierPerLanguage.test.js`: a static
   sweep over `src/**/*.ts` asserting (a) nothing beyond `effortDial.ts`
   (definition), `effortDialAdapt.ts` (apply edge) and `swarmPanel.ts`
   (operator dial) calls `switchRoleEffort`, and (b) no non-operator module
   calls `adaptRoleEffort`. Shown NON-VACUOUS: a planted
   `src/swarm/__bl1317_probe.ts` calling both failed both assertions with
   the offending path named; probe removed. Pattern follows the existing
   `test/negotiationStateSingleWriter.test.js` single-writer gate.

**Remaining, and NOT coder-ownable:** `required_wiring` item 1 on
`backlog/active/BL-1317-adapt-tier-effort-from-outcome-signals.yaml` still
reads as if a TS-side caller is a condition of done. Narrowing a ticket's
`required_wiring` is a spec edit, not a coder deliverable (Article 4.4:
spec gaps leave by note, never a parcel). A priority-`00` `spec-gap` note
goes to the specifier proposing item 1 be narrowed to name the bb consumer
as the live path and this edge as the reserved operator-driven one.

## Verification run

- `npx vitest run test/effortDialAdapt.test.js test/bl1317AdaptSingleApplierPerLanguage.test.js` — 22/22 PASS.
- `npx vitest run test/bl1317AdaptEffortInvariants.property.test.js --config vitest.properties.config.mjs` — 4/4 PASS (declared invariants 1 and 2).
- `bash swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh` — ALL PASS, 6/6 (BL-897).
- `npx tsc -p extension --noEmit` — clean.

By coder.
