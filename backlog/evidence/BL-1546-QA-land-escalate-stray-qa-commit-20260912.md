# BL-1546 land hold — QA's own stray evidence commit is an entangled closed-owner path (2026-09-12)

## What happened

BL-1546's own QA verification pass is clean (see
`backlog/evidence/BL-1546-QA-20260912.md`), approved commit `18f9d7749c`.
Running the BL-1241 remedy (`land_step_cli.bb`) before landing:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1518
ENTANGLED_SIBLING BL-1537
BL-1546-...: entangled tip - sibling ticket(s) BL-1518,BL-1537 unlanded as
ancestors, tip-pure replay could not complete cleanly; specifier
adjudication needed.
land-step: refusing to replay BL-1546 -
backlog/evidence/BL-1537-QA-land-escalate-BL1518-misattribution-20260912.md's
only owner(s) BL-1537 are closed on origin/main (backlog/done/) and no
commit of BL-1546's own touches
backlog/evidence/BL-1537-QA-land-escalate-BL1518-misattribution-20260912.md
- never decided silently (BL-1546)
```

This is BL-1546's own new clause working exactly as designed - refusing
rather than silently excluding. The complication: the entangled commit is
not a BL-1546 pipeline commit at all.

## Facts verified by hand

- The named path's only touching commit in `origin/main..HEAD` is
  `65ae4fd1e2` ("BL-1537: QA land-escalate finding — BL-1518 single-id
  misattribution drops documenter content", `By QA.`) — authored by QA
  2026-09-12 11:20, BEFORE BL-1546 was even minted (it is the source
  event: see BL-1546's own `source:` field and the specifier's
  `BL-1537-specifier-land-escalate-adjudication-closed-owner-20260912.md`).
  It sits in the `swarmforge-QA` worktree branch's linear history, not
  inside BL-1546's coder→documenter pipeline range.
- BL-1537 is closed on `origin/main` (`backlog/done/M8/BL-1537-...yaml`).
  Its actual 29-path deliverable set was already hand-landed at
  `e7faa7af5c` (ancestor of both `origin/main` and this HEAD) per the
  specifier's own recipe above. This scratch evidence file was correctly
  NOT part of that 29-path set (it is QA's own investigation note, not a
  BL-1537 deliverable) and so never landed and never will under BL-1537's
  own id.
- The other entangled id, BL-1518: the two paths `5dbd34f27f` touched
  (`docs/how-to/BL-1518-handoff-draft-root-guard.md` and the BL-1518-a
  feature file) are content-IDENTICAL between HEAD and `origin/main`
  today (`git diff origin/main HEAD -- <both paths>` is empty) — already
  landed via the hand-build. The `ENTANGLED_SIBLING BL-1518` line most
  likely comes from `65ae4fd1e2`'s own subject text naming "BL-1518" in
  prose (it leads with `BL-1537:` but mentions BL-1518), not from any
  content actually at risk.

## Why this does not qualify for QA to self-apply the specifier's standing recipe

The specifier's "rule for the next instance of this class" (in the
BL-1537 adjudication file) requires, among other things: (b) the
attributed commit is inside the LANDING PARCEL'S OWN range, authored by a
pipeline role of THIS parcel; (c) the landing ticket's own description or
evidence names the file as a deliverable. Both fail here: `65ae4fd1e2` is
not part of BL-1546's own coder/cleaner/architect/hardener/documenter/QA
pipeline commits, and BL-1546 does not name this file as a deliverable.
Per the specifier's own text, a failing condition is NEW information —
escalating rather than self-applying.

## Question for the specifier

The path's content is QA's own now-superseded investigation note (its
substance is preserved in the specifier's own landed adjudication file).
Options as I see them (not choosing one): (1) treat it as BL-1546's own
passenger and land it under BL-1546 (arguably wrong — it isn't BL-1546's
work); (2) hand-land it standalone under a non-forwarding BL-1537 note per
the existing recipe, then re-run BL-1546's land; (3) rule the path
abandonable (its content is superseded, nothing is lost) and have QA
record `abandoned_commits: [65ae4fd1e2]` on... no ticket cleanly owns that
- which is itself part of the question. QA is not deciding this alone.

By QA.
