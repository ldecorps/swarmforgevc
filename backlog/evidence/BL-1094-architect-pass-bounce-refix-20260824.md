# BL-1094 — architect pass (QA bounce re-fix), inventory NONE — 20260824

Reviewed cleaner `ede9e208a7` (on coder hitchhiker strip `a1a2feb5b3`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed. Prior architect
pass `1a65b20e63` remains in lineage; this pass re-reviews the bounce
clearance only, plus re-confirms the exemption architecture.

## Bounce context (Article 4.4 / BL-340)

QA bounce `backlog/evidence/BL-1094-qa-bounce-20260824.md` (commit
`ad8076e2c8`) named D1–D3 — all blamed **coder** — hitchhikers that
diverged BL-1113 HOTFIX_PATHS (`cursor-forge.conf`, `pipelineBoard.ts`
`&#160;` vs `&nbsp;`). Read from this worktree's evidence (landed with the
bounce merge); no earlier bounce remains uncleared.

## Scope of the re-fix tip

Coder `a1a2feb5b3` restores stamped `27273f2b0a` blobs for pack + board,
aligns `pipelineBoard.test.js`, and deletes hitchhiker-only
`swarmforge/packs/cursor-forge.prompt`. Cleaner evidence-only tip on top.
BL-1094 exemption code (`check-enabled?` / env seam / refusal log) unchanged
from the earlier clean pass.

## Bounce clearance verified this pass

| Item | Check | Result |
|---|---|---|
| D1 | `cursor-forge.conf` == `27273f2b0a`; BL-1113 pack scenario | OK / 9/9 acceptance |
| D2 | `pipelineBoard.ts` == `27273f2b0a`; board Outline `&nbsp;` | OK |
| D3 | HOTFIX_PATHS property + six-path `git diff --quiet` | OK / properties green |
| hitchhiker overlay | `cursor-forge.prompt` absent | OK |

## Architecture

- Strip is restore-to-stamped, not a redesign: board escape stays host-side
  `escapeHtml`; pack stays standing forge config. No new dependency edge,
  no webview storage, no tmux bypass.
- Re-checked BL-1094 option-(a) seam: `SWARMFORGE_DISPATCH_GAP_AUTOROUTE`
  still set only by `auto-route!` / harness; `blocked?` untouched;
  `check-enabled?` still gates coherence in `swarm_handoff.bb`.
- Integrate-not-fork unchanged.

## Required hard gate

    node extension/out/tools/dependency-gate.js \
      src/concierge/pipelineBoard.ts \
      test/bl1094DispatchGapAutoroute.property.test.js \
      test/bl1113CursorHotfixStampOff.property.test.js
    → PASSED: no forbidden edges.

## Co-change

`pipelineBoard.ts` ↔ its unit test (expected). Advisory only.

## Invariants (BL-1094 declared) — still encoded, green

Both declared invariants remain in
`bl1094DispatchGapAutoroute.property.test.js` (2/2). BL-1113 stamp-off
invariants re-verified green (2/2) as the bounce clearance gate.

## Property-testing support (undeclared)

No new property-shaped production module in the strip tip. No new property
authored.

## Correctness read-through

- BL-1094 acceptance 5/5; coherence unit ALL PASS; board unit 127/127.
- Restoring named `&nbsp;` matches the stamped BL-1113 certification; any
  Telegram named-entity concern from the hitchhiker belongs in a separate
  stamp-off, not this land tip (BL-848 / BL-506).
- No new defect spotted.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1094-the-auto-route-cites-head-so-the-coherence-gate-blocks-it`,
commit = this evidence commit (BL-536 / BL-806).

By architect.
