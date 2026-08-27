# BL-668 — documenter pass — 20260827

## Ticket

BL-668-post-qa-deterministic-branch-sweep

## Inbound

Merged coder `0a48a5f8eb` (handoffd.bb parens fix for post-QA sweep hooks).

## Review inventory (Article 4.4)

NONE.

## Docs impact

- `docs/diagrams/swarm-flow.mmd` — BL-668 sweep ff + merge-up notes for surfaced roles only
- `docs/how-to/BL-668-post-qa-deterministic-branch-sweep.md` — diagram cross-link
- Prior pass (2026-08-26): Specification.MD, index, how-to body unchanged

## Recovery note

Prior merge commit attempt triggered property-suite BL-1124 checkout corruption;
restored tip from reflog `b2c66927c0` before re-merge.

## Forward

`git_handoff` to `QA`, priority `00`.

By documenter.
