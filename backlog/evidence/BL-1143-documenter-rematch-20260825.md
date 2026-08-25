# Documenter rematch — BL-1143 onto origin/main (post BL-1142 QA land)

## Parcel tip
351da71529 (hardener batch BL-989+BL-1143 — never resurrect closed BL-989)

## Rematch posture
`git fetch && git reset --hard origin/main` (includes QA pass `25c4c1655` for
BL-1142) → restore BL-1143 paths only. Keep `BL-1142-qa-pass` evidence.
`dels=0`; ancestry verified immediately before handoff.

## Abandoned
`351da71529`, `9b12e8511e`, `1e3c1171c0`, `f9bc48e92c`, `4741a45c33`,
`e9572fa893`, plus WIP tip discarded after rematch onto QA land.

## Review inventory (Article 4.4)
NONE.

By documenter.
