# Documenter evidence — BL-732 rematch

## Ticket
BL-732-bl642-chrome-regex-misses-multiword-role-names

## QA bounce
e9668fb28f / origin `aa1843d4d1` — D1 tip purity (stale tip deleted
`backlog/evidence/BL-595-qa-pass-20260825.md` and
`docs/briefings/2026-08-25.json`)

## Rematch posture
`git reset --hard origin/main` → cherry-pick coder→cleaner→architect→hardener
(`707571810` … `d0633ea9fe`) → re-apply BL-732 docs only.

## Tip purity
- `origin/main` (`aa1843d4d1`) is ancestor
- `dels_on_origin=0`
- BL-595 QA evidence and `docs/briefings/2026-08-25.json` present
- Paths authorize BL-732 only
- `abandoned_commits`: tip-pure dupes `7075718109`, `dc62173208`,
  `38e5efee28`, `d0633ea9fe` (pre-rematch role tips replaced by cherry-picks)

## Review inventory (Article 4.4)
D1 cleared (rematch). No further inventory items.

## Docs impact
- Spec Last Updated (rematch note) + BL-642 residual paragraph
- How-to + BL-642 cross-link; index; architecture.mmd note

## Acceptance cross-check
Aligned with
`specs/features/BL-732-pane-title-chrome-covers-every-producible-role-name.feature`.

By documenter.
