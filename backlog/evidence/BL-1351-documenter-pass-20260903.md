# BL-1351 — documenter pass, 2026-09-03

Merged hardener commit `0d34a364b8` — clean merge, no conflict.

## Doc review

- Diff scoped to new `extension/src/bridge/streamSnapshot.ts` and
  `extension/src/bridge/bridgeServer.ts` (both `/events` producers
  rewired) — a bridge-internal wire-format change, no new extension
  command or setting, but a real user/operator-visible behavior change
  (frame size, what a client can observe on the stream) worth a
  Specification.MD entry, same as its sibling BL-1350 earlier today.
- No existing how-to describes the `/events` stream's per-item field
  shape specifically (BL-1350 didn't get one either — only a
  Specification.MD entry), so nothing was stale to correct.
- Diagram check: `architecture.mmd`'s change-trigger is the extension
  host/webview boundary, the tmux substrate relationship, or the
  `.swarmforge/` state layout. This narrows what an existing stream
  carries, not a new component or boundary. No diagram edit required.

## Action taken

Added a dated entry to `docs/reference/Specification.MD` (commit
`a43a81b095`) covering: the 6.7 MB measurement and why it mattered
(BL-1350's reconnect churn aggravator), the human's option-1 ruling
(narrow fields, keep every folder), the single-producer projection that
makes invariant 2 hold by construction, the exhaustive consumer sweep
and its `{id, title}` union, the architect's explicit ruling that the
JSON `/state` routes keep full fidelity (scope decided, not a side
effect), and the measured result against the 512000-byte budget.
`**Last Updated**` bumped in the same commit.

## Verdict

No documenter-domain defect found. Forwarding to QA.
