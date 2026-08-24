# BL-1094 — documenter pass (QA bounce re-fix) — 20260824

Commit reviewed: `c0136037c8` (hardener forward on coder hitchhiker strip
`a1a2feb5b3`). Merge into documenter completed; ancestry confirmed.
Also merged stranded QA bounce revert `4f44f255ab` for the PRE_QA ancestry
gate, then restored tip content from the pre-merge documenter tip
(`a85731905b`) so the revert could not silently re-delete the re-fix
(BL-954).

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read QA bounce `BL-1094-qa-bounce-20260824.md` (D1–D3 all blamed
**coder** — tip hitchhikers regressing BL-1113 HOTFIX_PATHS). No open
documenter item. Re-checked prior BL-1094 docs against the re-fix tip:

- `docs/reference/Specification.MD` — BL-1094 Last Updated entry still
  matches the exemption (`SWARMFORGE_DISPATCH_GAP_AUTOROUTE` / refusal log).
- `swarmforge/handoff-protocol.md` — Task/Commit Coherence Gate BL-1094
  exemption paragraph still accurate; strip did not change the seam.
- `docs/diagrams/architecture.mmd` — BL-1094 comment still correct.
- Hitchhiker strip restores stamped `27273f2b0a` blobs for
  `cursor-forge.conf` / `pipelineBoard.ts` — aligns with already-landed
  BL-1113 stamp-off docs; no new authored doc for the strip itself
  (classify, don't fill).
- README — no extension command/setting change from this re-fix.

No content edit required beyond this evidence commit (BL-536 / BL-806).

## Forward

`git_handoff` to QA, priority `00`, task
`BL-1094-the-auto-route-cites-head-so-the-coherence-gate-blocks-it`,
commit = this evidence commit.

By documenter.
