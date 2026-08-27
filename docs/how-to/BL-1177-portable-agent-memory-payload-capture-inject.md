# Portable agent-memory capture and inject (BL-1177)

*How-to. Task-oriented: produce and consume a schema-versioned portable memory
payload when swapping the model on the same role — without vendor-opaque blobs.*

Epic BL-1176 slice 1. Outgoing seat **captures** continuity; incoming seat
**injects** before live work. Hot-swap wiring is BL-1178; this ticket is the
pure API and payload contract.

## Payload shape

Capture emits `kind: 'portable-agent-memory-payload'` with
`schemaVersion: 1`, normalized `role`, `continuitySummary`, and
`openParcelContext.openParcelIds` (sorted, de-duplicated). Optional:
`handoffPack`, `toolStatePointers`.

## API

| Call | Location | Behaviour |
| --- | --- | --- |
| `capture(outgoingState)` | `extension/src/tools/agentMemoryTransfer.ts` | Pure aggregation → versioned payload |
| `inject(role, rawPayload)` | same | Validates; fail-closed on missing/malformed/role mismatch |
| `agentMemoryTransfer` | same | Namespace barrel for BL-1178 integration |

Named capture inputs (`CaptureNamedInputs`):

- `role`, `transcriptSummary`, `openParcelIds`
- optional `handoffPack`, `toolStatePointers`

Inject never sets `pretendedContinuity: true` — bad payloads return
`{ ok: false, signal: 'inject refused: …' }`.

## Operator check

When debugging a same-role swap (before BL-1178 lands end-to-end):

1. Capture from fixture or outgoing state — confirm `schemaVersion` and parcel ids.
2. Inject into target role — confirm `continuitySummary` and `openParcelContext` round-trip.
3. Feed `null` or malformed JSON — inject must refuse with a clear signal.

## Verify

```bash
cd extension && npm test -- agentMemoryTransfer
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1177-portable-agent-memory-payload-capture-inject.feature
```

Related: epic BL-1176; consumer wiring BL-1178 (hot-swap/trial); per-role
model swap BL-235 in Specification.
