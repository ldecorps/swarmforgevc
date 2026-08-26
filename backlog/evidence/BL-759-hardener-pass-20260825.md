# BL-759 — hardener pass — 2026-08-25

Architect tip: `62fe8651e4`. Recreated `swarmforge-hardender` on tip.
Authorize **BL-759 paths** only.

## Gates

| Check | Result |
|---|---|
| Acceptance | **10/10** |
| Properties | **2/2** (strengthened) |
| Full-repo dependency gate | **PASSED** |
| Soft Examples | **2/2 killed** (empty↔not-empty; 5000ms→default) |
| Surgical | **3/3 killed by properties** (always-true empty; ignore env timeout; empty roles) — acceptance also killed earlier sweep |
| Cooldown | bot `skip-cooldown`; drain/core/exec/liveness/notify **run** (hand surgical + props; no full Stryker this hop) |

## Harden this hop

Property invariant 2 now asserts:

- `controlDrainTimeoutMs('5000') === 5000` and default fallbacks
- `resolveLiveRoles` returns the seeded coder
- empty vs parcel-in-`inbox/new` emptiness

## CRAP / Stryker

Leaf `telegramPipelineDrain.ts` is small; CRAP not blocking. Full Stryker deferred (host quiet but parcel already covered by APS + props + surgical).

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-759-cursor-operator-front-desk-bot-import-cycle`, commit = this tip.

By hardener.
