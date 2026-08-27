# BL-780 — coder rematch2 (tip purity) — 20260827

## Bounce

QA `53c7fbaf2b`: rematch tip `823576ac63` still entangled (BL-506). Prior
coder tip `a3b53c22f3` was tip-pure in tree but `-s ours` ancestry of
entangled tips made merge onto newer `origin/main` conflict.

## Remediation

Fresh tip on current `origin/main` with BL-780 product files only — no
`-s ours` of entangled product tips. Stranded tips listed under
`abandoned_commits:` for pre-QA. Bounce evidence commits recorded separately
if needed.

By coder.
