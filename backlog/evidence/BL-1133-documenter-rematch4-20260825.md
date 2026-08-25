# BL-1133 — documenter rematch4 pass — 20260825

**Tip base:** hardener rematch3 `ab9bd329e3` (tip-pure; `dels_on_origin=0`)
**Task:** `BL-1133-babysitterd-heartbeat-start-and-end-of-tick`

## D1 remediation (blame: documenter)

Prior rematch3 merged hardener into dirty `swarmforge-documenter`
(`dels_on_origin=15`). Remediation:

1. `git reset --hard origin/main`
2. Fast-forward **only** tip-pure hardener `ab9bd329e3`
3. Stage QA bounce evidence alone (do **not** merge dirty QA tip)
4. Spec rematch4 stamp; confirm `dels_on_origin=0` before forward

## Docs

- Spec rematch4 stamp
- BL-611 / BL-675 pulse prose already on tip
- Extended `abandoned_commits` with hitchhiked rematch3 tips `e1b3fa77f7`,
  `be3419c28e`
- QA bounce rematch3 evidence + bounce_history (documenter)

## Inventory

NONE (cleared own D1)

## Forward

`git_handoff` to QA, priority `00`, same task name.

By documenter.
