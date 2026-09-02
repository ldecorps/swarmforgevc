# BL-1324 — cleaner re-pass after bounce fix (2026-09-02)

Stage: cleaner. This ticket was bounced back to coder earlier today
(`backlog/evidence/BL-1324-cleaner-bounce-20260902.md`, commit `8f19be8a0b`)
for a false-positive in invariant 2's property test. The coder fixed it in
commit `4c7bd1331a` ("BL-1324: scope invariant 2's parcel-artifact face to
ledger data"), which rode forward attached to the BL-1314 delivery
(`5a45f95bc1`) since BL-1324 had already left the coder's hands. Both
tickets are satisfied by the same merged tip in this worktree; forwarding
each under its own task name per Article 2.6.

## Checklist re-run this pass

- `npx vitest run --config vitest.properties.config.mjs
  test/bl1324ClaudeSeatQwenCloudContextWindowInvariants.property.test.js` —
  **3/3 pass**, including invariant 2 (previously failing). Confirmed the fix
  scopes the parcel-artifact scan to actual ledger-shaped `state:` lines
  rather than any prose mention, so the evidence file's own probe-B
  description no longer trips it.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature` —
  11/11 pass (unchanged from the original coder pass).
- `npm run compile` (extension/) — clean.
- `npx jscpd` re-run over the BL-1324 files — 0 clones (unchanged).
- No further production path touched by the fix (bounce-fix commit only
  edits the property test's own file).

## Verdict: NONE (beyond the coder's already-applied fix)

The single defect this stage found (D1, recorded 2026-09-02) is resolved.
No new cleanup change made. Forwarding.
