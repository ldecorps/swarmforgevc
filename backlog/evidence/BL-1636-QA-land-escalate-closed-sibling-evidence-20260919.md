# BL-1636 QA land-escalate — orphaned evidence commits from two already-closed siblings, 2026-09-19

`bb swarmforge/scripts/land_step_cli.bb BL-1636 HEAD` refused:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1634
ENTANGLED_SIBLING BL-831
BL-1636: entangled tip - sibling ticket(s) BL-1634,BL-831 unlanded as
ancestors, tip-pure replay could not complete cleanly; specifier
adjudication needed.
land-step: refusing to replay BL-1636 -
backlog/evidence/BL-831-coder-forward-gate-false-refusal-20260918.md's
only owner(s) BL-831 are closed on origin/main (backlog/done/) and no
commit of BL-1636's own touches
backlog/evidence/BL-831-coder-forward-gate-false-refusal-20260918.md -
never decided silently (BL-1546)
```

Checked against BL-1546's own standing recipe
(`BL-1537-specifier-land-escalate-adjudication-closed-owner-20260912.md`,
"Rule for the next instance of this class"), which lets QA apply the
recipe without a new escalation only when (a) the path's only owner(s)
are `backlog/done/` on origin/main, (b) the attributed commit is INSIDE
the landing parcel's own range (not an ancestor of origin/main, authored
AFTER the parcel's fork) by a pipeline role of this parcel, and (c) the
landing ticket's own description/evidence names the file as a
deliverable.

- (a) holds for both: `backlog/done/BL-831-bubble-pipeline-board-page.yaml`
  and `backlog/done/BL-1634-a-rejected-manifest-offers-no-page-from-it-built-ins-still-offered.yaml`
  are both on origin/main.
- (b) FAILS for both. `git log --oneline --ancestry-path
  6d63104e70..HEAD | tail -3` and the coder-branch history around
  `8acacfe5a5 Promote BL-1636: paused → active for coder` show
  `6d63104e70` ("BL-831: evidence - forward-gate false refusal") is an
  ANCESTOR of BL-1636's own promotion commit — it predates BL-1636 being
  promoted to active at all, so it is not "inside the landing parcel's
  own range". The BL-1634 offender is the same shape (its evidence
  commits sit earlier in the same shared coder-branch history, also
  before BL-1636 was promoted).
- (c) FAILS: BL-1636's description/`required_wiring`/`constraints` name
  no BL-831 or BL-1634 file as a deliverable; BL-1636's own `constraints`
  explicitly says "Evidence named BL-1636-*".

Two of the three conditions fail, so this is NOT the standing-recipe
instance (BL-1537's shape had the stray commit authored inside the
parcel's own range, by a role of that same ticket). This looks like a
distinct, likely-recurring shape: the long-lived `coder` worktree branch
accumulates evidence-only commits from tickets that later close, and
those commits are never landed on `main` on their own, so every
LATER ticket's `land_step_cli.bb` run inherits them as unlanded-sibling
ancestors indefinitely, regardless of how far back they sit.

## What I did NOT do

I did not hand-build a tip-pure replay excluding these two files myself —
BL-1546 exists specifically so this is never decided silently, and my
standing-recipe conditions above do not clear it.

## Ask

- Is BL-1636 clear to land carrying these two stray closed-sibling
  evidence files (harmless documentation, zero functional content), or
  should they be split out and hand-landed onto `main` on their own
  merits first (BL-1537's "Instance 2"/condition-(d) shape, extended to a
  commit that predates the citing parcel rather than one authored inside
  it)?
- If this is a recurring structural shape (stray evidence commits on a
  long-lived worktree branch, from tickets that close before their own
  commit lands), is a condition (e) worth adding to the standing recipe:
  "the attributed commit's ticket is already fully closed on origin/main
  and the file is pure evidence/documentation with no production-code
  content" — so QA does not have to re-escalate per closed-ticket-file
  pair going forward?

BL-1636 itself is fully verified and ready to land (unit 10791/10791,
property 1237/1237, acceptance 6/6, guard 4/4, reap e2e run) — this hold
is only about the two stray paths.

By QA.
