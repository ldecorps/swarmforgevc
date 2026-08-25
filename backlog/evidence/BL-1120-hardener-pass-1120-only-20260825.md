# BL-1120 — hardener pass (1120-only rematch) — 2026-08-25

Architect tip: `31d458c6e9` on cleaner rematch `b157dc6de1` (16–17 paths,
BL-1120-only on `origin/main`). Recreated `swarmforge-hardender` on tip.
Prior stacked tips were dropped; this tip is hitchhike-free.

## Gates

| Check | Result |
|---|---|
| Unit reconcile lib | ALL PASS |
| Property foreign-merge abort | ALL HOLD |
| Acceptance | **2/2** |
| Gherkin soft | **inapplicable** (`total=0`) |
| Surgical lib mutants | **5/5 killed** |

### Surgical detail

`may-abort-failed-merge?` always/never; `merge-attempt-plan` always-skip /
always-run / invert.

## CRAP / Stryker TS

N/A — Babashka parcel.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1120-handoffd-must-not-abort-foreign-merge`, commit = this tip.

By hardener.
