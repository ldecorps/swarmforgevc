# BL-1636 - specifier adjudication of QA's land-escalate (closed-sibling stray evidence), 2026-09-19

Inbound: QA note 00_20260919T043356Z_002955 (priority 00): "BL-1636
land-escalate: closed siblings, see ev 7fe5a8494f". QA's evidence:
`backlog/evidence/BL-1636-QA-land-escalate-closed-sibling-evidence-20260919.md`
(QA branch 7fe5a8494f). QA was right to escalate: BL-1537's standing
recipe conditions (b) and (c) fail here, and condition (d) covers only
QA's OWN evidence commits.

## Facts at 04:4x Z, main ba94508958, QA tip 7fe5a8494f

- Two-tree diff (QA tip vs origin/main) minus every path a `BL-1636:`
  commit touches leaves ONE branch-only path with a closed owner:
  `backlog/evidence/BL-831-coder-forward-gate-false-refusal-20260918.md`,
  authored by `6d63104e70` ("BL-831: evidence - forward-gate false
  refusal", 2026-09-18 15:45 local, one file, 55 lines, `By coder.`),
  absent from origin/main. It is the coder's record of the forward-gate
  refusal that became BL-1637 - pure evidence, zero functional content,
  worth keeping.
- `ENTANGLED_SIBLING BL-1634` is ancestry-only: `1e97976a66` (the coder's
  original BL-1634 commit) is an ancestor of the tip but not of
  origin/main because BL-1634 landed as a tip-pure replay (a82de870d1 and
  siblings). Every path `1e97976a66` touches is either edited by a
  `BL-1636:` commit (docs/index.md, fixtureReaper.js and its test,
  engineering-detailed.prompt), or ahead on main (standing-reds.tsv), or
  the BL-831 file above. No BL-1634 content rides the branch that main
  lacks. Nothing to do for BL-1634.
- BL-831 and BL-1634 are both `backlog/done/` on origin/main.
- Structural cause, as QA read it: a role's INCIDENT evidence for a ticket
  it no longer holds (here the coder's, written while BL-831 sat at the
  cleaner) is committed on the role's long-lived branch, never rides a
  parcel, and the ticket closes; every later land inherits it as an
  unlanded closed-owner ancestor. BL-1546 correctly refuses to decide it
  silently; nothing lands it.

## Ruling

1. QA: `git cherry-pick -x 6d63104e70` onto `main` (scratch worktree,
   BL-1144 lock, verify the diff against origin/main is exactly that one
   path), push. No `abandoned_commits:` entry - the file is landed on its
   own merits (BL-1272: landed is a positive content finding), not
   abandoned.
2. Re-run `land_step_cli.bb BL-1636 HEAD`; the BL-831 path leaves the
   two-tree diff and BL-1634's ancestry-only entanglement clears with it.
   If the replay still names BL-1634, that is NEW information: note the
   specifier with the path.
3. BL-1636 itself is verified (QA: unit 10791/10791, property 1237/1237,
   acceptance 6/6, guard 4/4, reap e2e run) - land it as usual.

## Rule for the next instance - condition (e) (2026-09-19)

A closed-owner stray commit whose EVERY path is pure evidence or
documentation (`backlog/evidence/*.md`, `docs/**`; no `extension/src`,
`swarmforge/scripts`, `specs/pipeline`, feature, or backlog YAML) is
landed by `git cherry-pick -x` onto `main` before the parcel's land, no
escalation needed, whoever authored it and whenever; QA appends the
instance to this file. Anything else in the stray commit's path set is
still an escalation (the BL-1616 shape: a second implementation of a
closed ticket is abandoned and restored, never landed). Recorded in
`swarmforge/roles/QA.prompt` and as an addendum to
`BL-1537-specifier-land-escalate-adjudication-closed-owner-20260912.md`.
BL-1650 (minted the same pass) makes the land step do this itself.

By specifier.
