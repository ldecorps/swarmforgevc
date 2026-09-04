# BL-1309 — QA re-pass, second inbound same day (20260903)

Received: documenter `32773705b4`, a hardener addendum (duplicate
`mkTmpDir` import from merging the coder's and hardener's independent
identical fixes for the same raw-`fs.mkdtempSync` defect). Forked from the
same base (`977fe447de`) as the first inbound
(`backlog/evidence/BL-1309-qa-spec-gap-unverified-ruling-20260903.md`),
built and forwarded concurrently with, and unaware of, the specifier's
re-pend (`0cd3d92c1f`, 09:38:56) — this branch last merged `main` at
08:48:44, before the re-pend existed.

## The fix itself: reviewed, no defect

Pure test-fixture hygiene — a duplicated `require` line from a merge of
two independent identical fixes, one call site, no production behavior,
no marker text, no exit code, no ruling logic touched. Documenter
confirmed the prior doc/spec content is unaffected. Taking this on trust
given its narrow, mechanical nature and the hardener/documenter's own
re-run verification battery (property 2/2, unit 9/9, mutation 6/2/0,
acceptance 6/6) — no independent re-verification needed for a duplicate-
import removal.

## Merged `origin/main` to pick up the correction

`git merge origin/main` (`958b1c4355`) brings this worktree's BL-1309
ticket state up to the specifier's own: `human_approval: pending`, no
`human_ruling:`. Confirms the block from the first inbound stands, for the
corrected reason recorded there (approval was genuine, a phone-pager
approval route silently drops the ruling — BL-1367/BL-1368, not a
self-flip; see the correction appended to the first evidence file).

## Verdict

STILL NOT APPROVED. No change from the prior pass's disposition — this
inbound adds a hygiene fix on top of the same unauthorized "option 1"
build, which remains unauthorized. No new note to specifier/coordinator:
they already know (the re-pend IS their action) and re-notifying would be
noise, not signal. Completing the inbound task without forwarding.
Nothing to merge up to; nothing landed.

By QA.
