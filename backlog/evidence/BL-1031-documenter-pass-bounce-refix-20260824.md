# BL-1031 — documenter pass (QA bounce re-fix) — 20260824

Commit reviewed: `3d5346c256` (hardener forward on fifo-handshake fixtures).
Merge into documenter completed; ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

QA bounce D1–D3 were flaky depth≥2 pipe-hold fixtures (bare `sleep & exit`
raced on WSL so `sh!` correctly returned 0). Tip is fixture-only —
production `sh!` / spawn-reachable libs unchanged. Spec Last Updated
(BL-1031), architecture comment, and BL-967 runbook note already describe
the landed behavior. No doc surface edit.

## Forward

Commit this evidence and `git_handoff` to QA, priority `00`, task
`BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree`.

By documenter.
