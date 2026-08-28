# BL-1179 architect bounce — 2026-08-28

## Review pass inventory

- **D1 — invariant-unencoded.** The ticket declares two `invariants:`:
  1. "Unsupported vendor pairs refuse transfer with a named matrix reason —
     never silent success."
  2. "Supported pairs use the portable payload from BL-1177 — not a second
     ad-hoc format."

  Neither has an executable property test, and no ticket note states a
  non-encodability reason. `vendorPairUnsupportedReason` /
  `transferMemoryAcrossVendors` (`extension/src/tools/agentMemoryVendorAdapters.ts`)
  are pure functions over a finite known-runtime table plus arbitrary
  strings (the fail-closed unrecognised-runtime path) — a natural fit for a
  fast-check property:
  - Property 1: for any two runtime tokens (drawn from the known table and
    from arbitrary strings, to exercise the unrecognised-runtime fail-closed
    path), `transferMemoryAcrossVendors(...).ok === true` implies
    `vendorPairUnsupportedReason(...) === null`, and the converse — an
    unsupported pair never returns `ok: true` and always carries a non-empty
    `signal` naming a reason.
  - Property 2: for any supported pair, `transferMemoryAcrossVendors`
    produces the same outcome shape/payload as calling
    `runMemoryTransferForRole` directly with the same inputs (delegation,
    not a second format) — e.g. asserted via an injected `deps` spy across
    generated role/state inputs.

  Only unit examples exist today (`extension/test/agentMemoryVendorAdapters.test.js`,
  15 hand-picked cases, well organized and covering both directions,
  case-normalization, and matrix derivation). A missing property test is
  itself the send-back per the Invariants Review section — I did not
  hand-verify the invariants against the example tests as a substitute.

- Dependency-rule gate (`extension/out/tools/dependency-gate.js` against
  `src/tools/agentMemoryVendorAdapters.ts`,
  `test/agentMemoryVendorAdapters.test.js`): **PASSED**, no forbidden edges.
- Co-change report: all pairs below the default frequency-3 threshold — no
  suspected coupling.
- required_wiring entry 1 (`agentMemoryHotSwap.ts::AgentMemoryTransferApi`):
  satisfied — `transferMemoryAcrossVendors` imports `AgentMemoryTransferApi`
  and delegates a supported pair to `runMemoryTransferForRole`, so the
  adapters/matrix are reachable from the live hot-swap seam, not an island.
  required_wiring entry 2 (`bl1179CrossVendorMemoryAdapterSteps` registered
  in `specs/pipeline/steps/index.js`): satisfied.
- Two-layer boundary / host-owns-I/O / no-webview-storage / integrate-not-fork:
  N/A — pure policy module, no webview or I/O surface.
- Correctness read: no defect found beyond D1. Verified the acceptance step
  `transfer succeeds using the portable payload` asserts against a real
  field (`MemoryTransferOutcome.payload`, confirmed present on the success
  variant in `agentMemoryHotSwap.ts`) — not a prompt-text or fake assertion.

## Remediation

Coder: add a `*.property.test.js` for `agentMemoryVendorAdapters.ts` using
fast-check, encoding both declared invariants above (generated runtime-token
pairs, including unrecognised tokens). Show each property fails when the
invariant is deliberately broken, then restore. Forward back through
cleaner → architect once added.

## Commit reviewed

dc1714bf3d (cleaner's merge of coder's 8395971a4).
