# Wire agent-memory into hot-swap and trial boundaries (BL-1178)

*How-to. Epic BL-1176 slice 2 — calls BL-1177 capture/inject on same-role model
switch paths before the incoming agent takes live work.*

## What runs where

| Path | Module | Behaviour |
| --- | --- | --- |
| BL-235 per-tile model dropdown | `backendSwitch.switchRoleModel` | Builds outgoing state from open parcels, runs transfer, then respawns |
| Hot-swap orchestration | `extension/src/tools/agentMemoryHotSwap.ts` | `runMemoryTransferForRole`, `attemptSameRoleModelSwitch` |
| Trial start / end | same | `runTrialBoundaryMemoryTransfer` (same capture→inject contract) |
| Payload API | `agentMemoryTransfer.ts` | BL-1177 — schema + fail-closed inject |

Outgoing capture state (`buildOutgoingCaptureState`) reads the role's handoff
inbox (`new/` + `in_process/` parcel ids) plus an optional transcript summary.

## Failure posture

Failed inject **aborts** the model switch — message prefix
`model switch aborted: agent-memory transfer failed`. The seat is not reported
as successfully swapped with amnesiac continuity.

## Verify

```bash
cd extension && npm test -- agentMemoryHotSwap
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1178-wire-agent-memory-into-hot-swap-and-trial.feature
```

Related: [BL-1177 portable payload](BL-1177-portable-agent-memory-payload-capture-inject.md);
per-role model swap BL-235 in Specification.
