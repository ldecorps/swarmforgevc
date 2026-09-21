# BL-1657 — LAND_ESCALATE, 2026-09-20

QA-approved commit `a8f0779522` (second pass, evidence `backlog/evidence/BL-1657-QA-20260920-2.md`).

Ran `bb swarmforge/scripts/land_step_cli.bb BL-1657 a8f0779522 .` (fully synced to `origin/main`
`9a71073a15` first, confirmed `git merge-base --is-ancestor origin/main HEAD`):

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1630
ENTANGLED_SIBLING BL-1663
BL-1657: entangled tip - sibling ticket(s) BL-1630,BL-1663 unlanded as ancestors, tip-pure replay could
not complete cleanly; specifier adjudication needed.
land-step replay: could not cherry-pick stray evidence commit 5dbfd9b6a6d3c411eaf906bc290fb0dfa77651f1
```

Investigated the blocking stray commit directly:

- `5dbfd9b6a6` ("BL-1459: document the documenter-briefing landing guard", one path,
  `docs/how-to/BL-658-briefing-trigger-derived-from-closure-schedule.md`) is a closed-owner
  (BL-1459 is in `backlog/done/`), pure-documentation stray — matches the standing recipe (e)
  adjudication (`BL-1636-land-escalate-0919-pure-evidence-closed-owner-stray-rule-e` shape).
- Hand cherry-picked it onto a throwaway branch off fresh `origin/main` to land it per rule (e):
  conflicted against `origin/main`'s own text (a LATER, more complete rewrite of the same section,
  from a subsequent rebuild round on 2026-09-20 that fixed a critical bug the stray's older text
  doesn't have). Resolved by keeping `origin/main`'s side — the stray's content is fully superseded.
  Result: `git cherry-pick --continue` reported "nothing to commit" (empty diff); skipped the
  cherry-pick and deleted the throwaway branch. **Nothing needed landing for this stray at all.**
- `BL-1663` is also misreported: it landed and closed on `origin/main` already (`cedb993ae3`, verified
  content-identical to my approved commit, `backlog/evidence/BL-1663-land-escalate-20260920.md`
  from earlier this session covers the same shape for a different parcel). The land step's
  entanglement walk appears to abort at the FIRST cherry-pick failure (the empty-diff stray above)
  before it gets far enough to resolve BL-1663 to `LANDED_SIBLING`.
- `BL-1630` remains genuinely unlanded (active, mid-bounce with coder) — correctly entangled.

**Root cause, as far as I can tell without editing land_step_lib.bb myself**: the replay's cherry-pick
step does not tolerate a stray commit whose content is already fully present on `origin/main` under
different phrasing (an empty diff after conflict resolution) — it treats "nothing to commit" as a
failure rather than a no-op success, and aborts the whole walk rather than continuing past it. This
looks like the same tooling gap standing recipe (e) already names (it defers automation to BL-1650),
now hit in an "empty after resolution" shape neither prior instance saw (which cherry-picked cleanly).

Per QA.prompt's BL-1241 remedy item 3/4: escalating to the specifier rather than hand-rebuilding a
tip-pure commit myself. Since I have already confirmed BL-1663 is landed and the stray is moot, I
believe a rebuild would in fact be straightforward (own paths minus BL-1630's), but I am not
comfortable asserting that without an adjudication given today's several BL-1636/BL-1650/BL-1656/BL-1663
land-step incidents already have the specifier actively working this exact area.

## Second instance — BL-1661's land, same class (QA, 2026-09-20)

`bb swarmforge/scripts/land_step_cli.bb BL-1661 699d189c95 .` hit the identical shape:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1630
ENTANGLED_SIBLING BL-1657
ENTANGLED_SIBLING BL-1663
BL-1661: entangled tip - sibling ticket(s) BL-1630,BL-1657,BL-1663 unlanded as ancestors, tip-pure
replay could not complete cleanly; specifier adjudication needed.
land-step replay: could not cherry-pick stray evidence commit be826a206037d053549585bf6e8136faee696e84
```

`be826a2060` ("Land-escalate adjudication log: append the BL-1653 instance") touches only
`backlog/evidence/BL-1537-specifier-land-escalate-adjudication-closed-owner-20260912.md`. Confirmed
its content is a strict subset of `origin/main`'s current version of that same file
(`git diff origin/main be826a2060 -- <path>` shows zero added lines) — origin/main already carries a
later, larger append that supersedes it entirely. Same empty-diff-stray shape as the first instance
above; BL-1657 is also still correctly entangled (unlanded, awaiting the coder's fix after my bounce)
and BL-1630/BL-1663 as before (BL-1663 still misreported — it landed and closed at `cedb993ae3`).

Not sending a second priority-00 escalation for this (Article 4.4/QA.prompt's "escalate once per
class") — appending here instead, per the specifier's own standing recipe for this log. BL-1661
remains approved (`backlog/evidence/BL-1661-QA-20260920.md`) and unlanded pending the same fix.

By QA.

## Third instance — BL-1667's land, same class (QA, 2026-09-20)

Identical shape: `land_step_cli.bb BL-1667 3e3e4765a9 .` hit the same stray `be826a2060` cherry-pick
failure, with `ENTANGLED_SIBLING BL-1630,BL-1657,BL-1661,BL-1663`. No new information. BL-1667 remains
approved (`backlog/evidence/BL-1667-QA-20260920.md`) and unlanded pending the same fix. Not sending a
third escalation note.

By QA.

## Fourth instance — BL-1664's land, same class (QA, 2026-09-20)

Identical shape: `land_step_cli.bb BL-1664 f197a49556 .` hit the same stray `be826a2060` cherry-pick
failure, with `ENTANGLED_SIBLING BL-1630,BL-1657,BL-1661,BL-1663,BL-1667`. No new information. BL-1664
remains approved (`backlog/evidence/BL-1664-QA-20260920.md`) and unlanded pending the same fix. The
approved-but-unlanded queue behind this one root cause is now: BL-1657, BL-1661, BL-1667, BL-1664 (four
tickets), plus genuinely-unlanded BL-1630 and misreported-landed BL-1663.

## Fifth instance — BL-1630's land, same class (QA, 2026-09-20)

`land_step_cli.bb BL-1630 f83f672320 .` hit the same stray `be826a2060` cherry-pick failure, with
`ENTANGLED_SIBLING BL-1657,BL-1661,BL-1663,BL-1664,BL-1667` (BL-1630 itself correctly excluded from
its own entanglement list). BL-1630's land was expected to unblock the queue behind it (it was the one
genuinely-unlanded sibling in every prior instance) — it does not, because the blocker is the
unrelated stray commit, not BL-1630. BL-1630 remains approved (`backlog/evidence/BL-1630-QA-20260920.md`)
and unlanded pending the same fix. Five tickets now queue behind this one stray commit.

By QA.
