# BL-820 closing-ceremony-lean-pass — architect re-pass — 20260808

Commit reviewed: `649a28d446` (cleaner's forward), received as
`merge_and_process cleaner 649a28d446`.

## Why this is a fresh pass, not a duplicate of `BL-820-architect-pass-20260808.md`

My prior pass (`eb48c047`, "clean, no defects") reviewed coder's original
commit (`09edd805`) only. Everything since — hardener's DRY/CRAP split
(`efc7d9f4`), documenter's docs, QA's bounce
(`BL-820-closing-ceremony-lean-pass-bounce-20260808.md`, D1: cleaner's pass
was untraceable), and cleaner's now-real remediation pass
(`BL-820-cleaner-pass-20260808.md`, explicit NONE) — landed *after* that
prior pass and reached architect for the first time only now. This pass
reviews all of it, focused on hardener's refactor (the only architecturally
material code that changed since my last look).

## Checklist run

- **Dependency-rule gate (BL-259, hard gate):** `node
  extension/out/tools/dependency-gate.js` against all 9 files this ticket
  touches (the 7 `src/**` files hardener's commit changed, plus
  `metrics/closingCeremonyRun.ts` / `metrics/closingCeremonyStore.ts`
  unchanged since my prior pass). Result: **PASSED, no forbidden edges.**
- **Co-change / logical coupling (BL-255):** `node
  extension/out/tools/co-change-report.js` against the same 9 files. Every
  reported pairing is frequency 1 — below the suspected-coupling threshold
  (3). No action needed.
- **Hardener's refactor, read for behavior preservation:**
  `buildHypotheses` split into `primaryHypotheses`/`fallbackHypotheses` —
  the new `primary.length > 0 ? primary : fallbackHypotheses(parts)` gate
  reproduces the original's `hyps.length === 0` guard exactly (fallback only
  fires when dwell/bounce/stall produced nothing). `isValidCeremonyAdjustment`
  split into `isValidAdjustmentKind` + `isValidReversibleRecord` preserves the
  original check order (kind → detail → recordedAt → record.form/ref).
  `isValidCeremonyOutcome` split into `isValidOutcomeRef` likewise preserves
  the `no_change` vs. non-`no_change` branching verbatim. `isValidShiftKey`
  hoisted into `quality/closingCeremony.ts` (pure, no fs) and imported by
  both Args files — a policy-layer helper reused by two adapter-layer
  callers, which is the correct dependency direction (adapters depend
  inward), not a new edge (both Args files already imported from
  `quality/closingCeremony`). `resolveTargetAndNow` hoisted into
  `tools/swarm-metrics.ts`, reused by the three closing-ceremony CLI
  wrappers — stays within the tools/ layer, no boundary crossed.
- **Two-layer boundary / host-owns-IO / webview storage / secrets:**
  unchanged from my prior pass — no webview code touched, no tmux/process-
  spawn added, no secrets introduced. N/A carries forward.
- **Policy/IO separation:** still holds after the refactor —
  `quality/closingCeremony.ts` remains fs-free; `metrics/
  closingCeremonyStore.ts` remains the sole read/write layer; `tools/
  closing-ceremony-*.ts` remain thin wrappers over the injected `sendNote`
  seam.
- **Declared invariant (BL-633/BL-654):** re-ran
  `extension/test/closingCeremonyInvariant.property.test.js` against the
  current tree (`npx vitest run --config vitest.properties.config.mjs
  closingCeremonyInvariant`): **2/2 passed, 100 runs each.** Confirms
  hardener's refactor didn't disturb the one declared invariant.
- **Property-testing pass (my own ownership section):** hardener's new
  helpers (`primaryHypotheses`, `fallbackHypotheses`,
  `isValidReversibleRecord`, `isValidAdjustmentKind`, `isValidOutcomeRef`,
  `isValidShiftKey`) are validation/branching predicates over closed
  vocabularies, not round-trip/idempotence/ordering-shaped — already
  covered by targeted example-based unit tests. No new property-shaped
  module introduced; no property test added.
- **Unit tests:** `npx vitest run closingCeremony`: **67/67 passed** —
  unchanged count from my prior pass, confirming the refactor is behavior-
  preserving.
- **Cleaner's remediation:** read `BL-820-cleaner-pass-20260808.md` — real
  review against the post-hardener tree, explicit NONE, checks listed
  (jscpd 0 clones, compile clean, 40/40 targeted tests). Satisfies QA's D1
  remediation pointer.

## Verdict

**NONE** — no defects found. Hardener's refactor is architecturally
compliant and behavior-preserving. Forwarding to hardener per the QA bounce
remediation's re-traverse instruction (architect → hardener → documenter →
QA).
