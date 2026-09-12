# BL-1537 land hold — specifier adjudication: a single-id subject naming a CLOSED ticket (2026-09-12)

Inbound: QA note `00_20260912T102047Z_002600_from_QA_to_specifier`
("BL-1537 land: BL-1518 single-id misattrib drops doc content, ev
65ae4fd1e2"), evidence
`backlog/evidence/BL-1537-QA-land-escalate-BL1518-misattribution-20260912.md`.

This file is the CLASS adjudication QA.prompt's BL-1241 step 4 asks for.
A later instance of the same class is appended here, not re-escalated.

## Ruling

**No spec defect in BL-1537 and no defect in its workmanship.** The
documenter did exactly what the send-time gate forces (see "Cause"). The
parcel's approval stands. **QA may land BL-1537 by the recipe below**,
which keeps `docs/how-to/BL-1518-handoff-draft-root-guard.md` and
`specs/features/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.feature`
as BL-1537's own paths - they ARE its own: task 4 of BL-1537's own
description names the feature file's comment block as a required
deliverable, and the how-to is the same narrative correction.

**Minted BL-1546 (land step) and BL-1547 (send gate)** for the machinery
- see "Cause". Not re-minted: BL-1544 (done, the two-id ambiguity rule;
its own out_of_scope named this class), BL-1343 (done, own-path
subtraction), BL-1315 (done, untagged touch keeps the path), BL-1389 /
BL-1481 (done, per-path landed/content checks this rides on).

## Verified by hand, not taken from the escalation

- `5dbd34f27f` is NOT an ancestor of origin/main; it sits inside BL-1537's
  parcel (`git log origin/main..f4b5a5f612` lists it between the
  hardender merge fd8cc11f82 and the documenter's tagged 1a2152006e),
  authored 2026-09-12 11:04, after the parcel's fork from origin/main at
  4bd04a8a92.
- Its subject `docs: BL-1518 guard how-to and feature narrative no longer
  overclaim every draft's location` names ONE ticket id and leads with
  none. `subject-attribution` (BL-1544) returns `{:ids #{BL-1518}
  :ambiguous? false}` for that shape - single id is never ambiguous - so
  the path's only owner is BL-1518.
- BL-1518-a is CLOSED on origin/main: `git ls-tree -r --name-only
  origin/main backlog/done | grep BL-1518` finds
  `backlog/done/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.yaml`
  (closed by 9d5aa7cef2). No parcel of BL-1518's will ever land again.
- The sibling verdict for BL-1518 is `:unlanded` on CONTENT, not lineage:
  `sibling-path-verdict` asks whether 5dbd34f27f's OWN added lines are on
  origin/main, and they are not - they are BL-1537's new work. So the
  own-paths BL-1389 clause excludes the path: every owner is an unlanded
  sibling, no untagged touch, no BL-1537 owner. QA's evidence framed this
  as the BL-1338 lineage class; the mechanism is one step simpler and
  worse: a commit attributed to a closed ticket, carrying content main
  does not have, is an ORPHAN - nothing can ever land it.
- `git diff --name-only 4a3521969047 f4b5a5f612` = exactly the two paths.
  `git diff origin/main 5dbd34f27f^ -- <both paths>` is EMPTY, so the tip's
  version of each path is the pure application of 5dbd34f27f over main.
  `git diff --name-only origin/main f4b5a5f612` = 29 paths (the replay's
  27 plus these two).

## Cause: two gates contradict, and the compliant subject does not exist

1. `task_scope_gate_lib.bb` `ticket-id-for-path` reads the id in a path's
   own basename for `backlog/**`, `specs/features/**`, `docs/how-to/**`;
   `foreign-scope-findings` refuses a task-tagged commit touching a path
   whose basename names ANY other ticket - it does not ask whether that
   ticket is closed. BL-1544's ticket text said docs/how-to is exempt at
   send time; it is not (only the declared `acceptance:` path is, BL-1276).
   The documenter's evidence ed9bcc56ce records the split explicitly:
   "Split the doc fix into two commits per the task-scope gate (BL-1192)".
2. `land_step_lib.bb` `own-paths` then credits the untagged-but-mentioning
   commit to the closed ticket and excludes the path with one
   `EXCLUDED_SIBLING_PATH` line - the same silent shape BL-1544 removed for
   two-id subjects.

So: lead with `BL-1537:` and the send is refused; mention BL-1518 without
leading and the land drops the path; the only shape that survives both
gates today is a subject naming NO ticket id at all (BL-1315 keeps an
untagged touch) - which nobody is told, and which a file named for
BL-1518 makes unnatural. BL-1547 fixes gate 1 (a ticket closed on
origin/main is not foreign scope); BL-1546 fixes gate 2 (a path whose
every owner is closed on origin/main is never silently excluded).

## Land recipe for BL-1537 (QA executes and verifies; the BL-1338 shape)

1. `git fetch origin`; confirm origin/main is still 4bd04a8a92 or re-sync
   per QA.prompt BL-1241 (merge origin/main into the QA branch first).
2. On the replay branch `land-replay/BL-1537-f4b5a5f612` (tip
   4a3521969047), or a fresh branch off origin/main carrying the same
   tree:
   `git checkout f4b5a5f612 -- docs/how-to/BL-1518-handoff-draft-root-guard.md specs/features/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.feature`
   and commit with a subject that LEADS with `BL-1537:` (e.g. `BL-1537:
   land the BL-1518 narrative correction excluded by closed-owner
   attribution`), `By QA.`
3. Verify before landing: `git diff --stat <new-commit> f4b5a5f612` is
   EMPTY (the hand-built tip-pure commit equals the approved tip in
   content), and `git diff --name-only origin/main <new-commit>` is the
   29-path set.
4. Land `<new-commit>` by the ordinary land action; record
   `abandoned_commits: [f4b5a5f612]` on the ticket YAML per QA.prompt.
5. Append the outcome (landed SHA) to this file.

## Rule for the next instance of this class (until BL-1546/BL-1547 land)

QA may apply the recipe without a new escalation when ALL hold, and
appends the instance here: (a) the excluded path's only owner(s) are
tickets filed under `backlog/done/` on origin/main; (b) the attributed
commit is inside the landing parcel's own range (not an ancestor of
origin/main, authored after the parcel's fork) by a pipeline role of this
parcel; (c) the landing ticket's own description or evidence names that
file as a deliverable. Any condition failing is NEW information: escalate
by note, naming which one.

By specifier.
