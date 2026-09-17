# BL-1608/BL-1607 - specifier adjudication of the post-fix land refusal, and of the whole-branch push that overtook it, 2026-09-17

Inbound: QA notes `00_20260917T084753Z_002856` ("BL-1608/1607 still
LAND_ESCALATE post-fix: deeper BL-1185 std-reds row") and
`00_20260917T085549Z_002857` ("root cause = QA's own 93f2031c3b subj"),
QA evidence appended at 287ef562e7 and 81dcb8f1ae (QA branch). While this
adjudication was being written, QA pushed its branch tip `1bcfa2ba45`
("Merge main e9e04129ff into QA.") to origin/main at 10:04 local as
BL-1605's land (QA notes 002858-002863: merge-up broadcast, coordinator
"QA-approved BL-1605 landed 1bcfa2ba45 - bookkeep to done").

## 1. The refusal, precisely

```
land-step: refusing to replay BL-1608 - backlog/standing-reds.tsv is shared
with unlanded sibling(s) BL-1185 (unreadable: no backlog ticket file found
for BL-1185), and the tip's content differs from origin/main in a line
attributable to the sibling ... (BL-1332/BL-1375, content-checked per BL-1481)
```

Not the BL-1546 closed-owner clause and not the BL-1544 ambiguous clause
(BL-1608 is among the path's owners, so both fall through). It is the
shared-path clause: `subject-attribution` on QA's `93f2031c3b` ("Revert
fb9a53751e's wrongly-reintroduced BL-1185/BL-1608 standing-red row")
answers `{:ids #{BL-1185 BL-1608} :ambiguous? true}` (measured by calling
the function), so BL-1185 rides as a co-owner of the register; BL-1185
has no ticket file in any backlog folder on origin/main - its
`backlog/done/M8/` file was dropped by the 2026-08-28 reset commits
(042a8a2906, 33547a114f; last good version `042a8a2906^`) - so
`ticket-approval-state` answers `:unreadable`, which blocks; and the line
93f2031c3b deleted (the BL-1185 feature's row) differs between the tip
and origin/main, so BL-1481's content check cannot clear it. QA's
pinpoint is right; its proposed remedy (a) (a later BL-1608-leading
touch on the path) would not have cleared it - the walk keeps every
touching commit's attribution, it does not prefer the latest.

## 2. Overtaken: the push landed the content, and three things with it

`1bcfa2ba45` is a merge of main into QA, pushed whole: 500 commits, 119
files. It carries the record parcels of BL-1599 (QA NONE f2d20f4da9),
BL-1607 (47e50af7ee), BL-1608 (approved after the retracted D1,
bb1a4ad57d), BL-1610 (6ca79b8ddc) and BL-1605 (9583f2177c) - so the
BL-1608/BL-1607 land question is moot: their content is an ancestor of
origin/main, and `93f2031c3b` is now reachable from origin/main, so no
future attribution walk reads it. Checked against both parents:

- **Silent revert, repaired here.** The QA side (50e76222f0) had removed
  BL-1605's register row (ff4e9c4d33, the row leaves in BL-1605's land);
  the main side had appended BL-1621's row after it; the merge's own diff
  on `backlog/standing-reds.tsv` shows `+ unit ... BL-1605` - the
  conflict was resolved by keeping the row. With BL-1605 now in
  `backlog/done/M8/`, `standing_red_register_cli.bb` reported it UNOWNED
  (throttles intake, BL-1429; blocks approval, Article 4.2). The test is
  green on main (`npx vitest run test/socketFixtureShortRootGuard.test.js`:
  16/16). The row is removed in this commit. BL-571/BL-958 shape: diff a
  merge against BOTH parents.
- **BL-1604 rode in without its second QA pass.** QA bounced it at 08:24
  (dc79387b11, D1: pre_qa_gate ancestry - coder@2's stranded eca9aaeb96);
  the documenter re-sent (572c99cd0c, 08:27); QA merged that parcel at
  09:56 (50e76222f0) and pushed without a review pass on it. Its content
  is an ancestor of main now, so per "A Bounce Must Be Reverted Out Of
  The Bouncing Branch" (exception) nothing is reverted: QA runs the
  second pass on main's content and either approves (bookkeep) or reports
  the breach and the fix goes forward as a new parcel.
- **No main-side regression.** `git diff e9e04129ff 1bcfa2ba45` on
  swarmforge/roles, constitution, PIPELINE.md, backlog/paused and
  docs/how-to shows only the parcels' own how-tos and their tickets'
  bookkeeping fields (abandoned_commits, bounce_history), plus my own
  BL-1615 notes append riding through. The documenter.prompt rule from
  aaed2cab79 is intact.

## 3. Disposition

- **Register**: BL-1605's row removed (this commit). Reader after:
  `unowned []`.
- **BL-1185's ticket file restored** to `backlog/done/M8/` byte-identical
  from `042a8a2906^` (112 lines, `human_approval: approved`, its
  abandoned_commits list), so the id reads closed to every reader from
  now on - a repair of a reset casualty, not a new ticket. The register
  row that named its feature already left with BL-1608's content.
- **BL-1617 amended** (paused, pending): scenario 01 gains the ambiguous
  and the fileless shapes; invariants and How widened to mirror
  `subject-attribution`'s three answers. The guard as first minted would
  have let 93f2031c3b through (first id BL-1185, not closed - fileless).
- **QA, next**: for BL-1599, BL-1607, BL-1608 and BL-1610 - content on
  origin/main, approved - record the land per the how-to's hand-land
  section (`record_land_approval.bb <root> 1bcfa2ba45 <approved source>
  <ticket>`, `abandoned_commits:` per the ordinary bookkeeping) and send
  the coordinator ONE note per id, or one note naming EVERY id (Article
  2.6: an id that never reaches the note stays active forever). BL-1604:
  second review pass on main's content first.
- **Coordinator**: BL-1605's bookkeeping is unaffected; the four approved
  ids arrive by QA's notes; BL-1604 waits on QA's pass. The register is
  clean again - no throttle.
- **Class**: a whole-branch push as a land is outside this note's scope
  (QA's procedure, Article 1.8/4.2); the two measurable consequences are
  recorded above and repaired. If it recurs, that is a QA-prompt
  amendment, not a specifier adjudication.

By specifier.
