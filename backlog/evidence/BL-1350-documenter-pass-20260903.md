# BL-1350 — documenter pass, 2026-09-03

Merged hardener commit `05b3318e4b` (merge commit `7c8b5d27ce` in this
worktree — one additive conflict in `specs/pipeline/steps/index.js`, both
sides adding a different `require(...)` line; resolved by keeping both).

## Doc review

- Diff scoped to `extension/src/bridge/bridgeServer.ts` (coder commit
  `f65f7d8f2d`; cleaner/architect/hardener passes made no further diff to
  that file per their own evidence).
- No new extension command, setting, or user-facing UI change — this is an
  internal SSE liveness fix on `/events`.
- Diagram check: `architecture.mmd`'s change-trigger is the extension
  host/webview boundary, the tmux substrate relationship, or the
  `.swarmforge/` state layout. A keepalive frame on an existing stream
  changes none of those — no diagram edit required.
- `docs/explanation/how-the-front-desk-works.md` already describes the
  bot picking up replies "over the bridge SSE stream" at a level general
  enough that the fix doesn't make it inaccurate — left unchanged.
- No existing doc mentioned the `reply-relay degraded ... terminated`
  failure mode, so there was nothing stale to correct.

## Action taken

Added a dated entry to `docs/reference/Specification.MD` (commit
`0f59c6db37`) covering: the undici 300000 ms `bodyTimeout` root cause, the
hold-test evidence, `writeSseKeepalive`'s placement in the live module (the
BL-1235 shape this ticket avoids), the SSE-comment inertness to both
`EventSource` and this repo's own reader, the dead-client/throwing-write
drop behavior, and that the BL-1111 alert/backoff is untouched (the failure
it reports is removed, not silenced). `**Last Updated**` bumped in the same
commit as the content change.

## Verdict

No documenter-domain defect found. Forwarding to QA.
