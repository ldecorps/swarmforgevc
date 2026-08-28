# Cross-vendor memory adapters and the unsupported matrix (BL-1179)

*How-to. Epic BL-1176 slice 3 — decides WHICH runtime pairs may attempt an
agent-memory transfer at all, and refuses the rest with a named reason
instead of a silent no-op.*

BL-1177's portable payload is already vendor-agnostic, so a supported pair
needs no second format: it transfers through
[BL-1178's hot-swap wiring](BL-1178-wire-agent-memory-into-hot-swap-and-trial.md)
exactly as a same-vendor swap does. This slice adds the per-runtime table
that decides which pairs may attempt that, and the matrix that names why
the rest cannot.

## Module

`extension/src/tools/agentMemoryVendorAdapters.ts`

| Function | Role |
| --- | --- |
| `runtimeMemoryAdapter(runtime)` | The adapter entry for a runtime token; an unrecognised token gets a fail-closed unsupported entry, never a crash or a silent pass |
| `vendorPairUnsupportedReason(out, in)` | The refusal reason for a pair, or `null` when both sides support transfer |
| `isSupportedVendorPair(out, in)` | Boolean wrapper over the above |
| `unsupportedVendorMatrix()` | Every unsupported pair among the known runtime table, queryable without a live swap |
| `transferMemoryAcrossVendors(out, in, role, state, deps?)` | The entry point: refuses an unsupported pair with a named reason, or delegates a supported pair to `runMemoryTransferForRole` unchanged |

## The runtime table

`RUNTIME_MEMORY_ADAPTERS` — every agent token
`prompt_engine_lib.bb`'s own provider-capabilities table recognises.
Supported: `claude`, `codex`, `copilot`, `grok`, `vibe`, `gemini`,
`cursor`, `local-model`. Unsupported, each with a named reason:

| Runtime | Why |
| --- | --- |
| `aider` | a file-editor CLI with no session/transcript continuity mechanism — every invocation starts from a fresh prompt |
| `mock` | a test-only stub runtime, never a real memory participant |

An unrecognised token is unsupported too — `unrecognised runtime "<token>"
is not in the memory-adapter table — fail closed` — never treated as
allowed by omission.

## Refusal shape

An unsupported pair never transfers and always names which side(s) refuse
and why:

```
unsupported vendor pair (aider → claude): aider does not support memory
transfer as the outgoing runtime: aider is a file-editor CLI with no
session/transcript continuity mechanism to inject a portable payload
into — every invocation starts from a fresh prompt
```

A supported pair is never refused at the matrix step — it delegates
verbatim to `runMemoryTransferForRole`, the same BL-1177 capture/inject a
same-vendor swap already uses, never a second ad-hoc format.

## Reading the matrix without a live swap

`unsupportedVendorMatrix()` derives every unsupported pair from the
per-runtime table above — never a hand-maintained second list, so a
runtime's support flag changes in exactly one place.

## Verify

```bash
cd extension && npm test -- agentMemoryVendorAdapters
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1179-cross-vendor-memory-adapters-unsupported-matrix.feature
```

Related: [BL-1177 portable payload](BL-1177-portable-agent-memory-payload-capture-inject.md);
[BL-1178 hot-swap/trial wiring](BL-1178-wire-agent-memory-into-hot-swap-and-trial.md).
