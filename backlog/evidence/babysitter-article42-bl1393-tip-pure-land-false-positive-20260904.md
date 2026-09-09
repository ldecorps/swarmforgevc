# Article 4.2 / BL-247 escalation on 8e53a3e853 — FALSE POSITIVE (operator, 2026-09-04T22:17Z)

BABYSITTER_ESCALATION `pipeline-code-on-main-8e53a3e853665ea3960fceade99676237cecc7c5`
flagged `BL-1393: tip-pure land -- own paths only, replayed onto origin/main`
(author t <t@t>, authored 2026-09-04T23:10:07+01:00 = **22:10:07Z**) as
"pipeline code landed on main outside QA" for:

- extension/src/quality/nightClosingCeremonyLive.ts
- extension/src/tools/night-closing-ceremony-run.ts
- extension/test/bl1393OneCeremonyEverySleep.property.test.js
- extension/test/nightClosingCeremonyLive.test.js
- extension/test/nightClosingCeremonyRun.test.js
- specs/pipeline/steps/bl1393CeremonyOnEverySleepSteps.js
- specs/pipeline/steps/bl658BriefingTriggerDerivedFromClosureScheduleSteps.js

## Why it is a false positive

Thirteenth instance of the standing class recorded in this directory (most
recently `...-bl1398-tip-pure-land-...` and `...-bl1399-amendment-land-...`,
both today). The Article 4.2 predicate (`swarmforge/scripts/is_qa_ancestor.sh`)
is **ancestry-only**: it asks whether the sha is an ancestor of `swarmforge-QA`.
A QA **hand-built tip-pure land** — the BL-1376 recipe, mandated here because
the cited parcel `fd785f89ea` carried unlanded sibling tickets as ancestors
(LAND_ESCALATE, BL-1386 adjudication route 1) — is by construction a *replay*
of QA's own attributed paths onto `origin/main`, so it can never be an
ancestor of the QA ref. The predicate therefore ALWAYS flags this route.

## Checks run (all UTC)

- `is_qa_ancestor.sh 8e53a3e853…` → **rc=1**, run directly (not through a pipe).
- **Bounce arm ruled out**: no `8e53a3e853` anywhere under `.swarmforge/bounces/`
  or `backlog/**` bounce_history, so the "no" is purely ancestry.
- **Decisive content check**: every one of the seven flagged paths is
  byte-identical on `main`, `swarmforge-QA` and `origin/main`
  (aaa8789780 / b900f92fdc / bbd0611ff4 / 2f394c9cdd / 32ed3e43d5 /
  e5b2ec5497 / 30dcf1f0bd) — the code on main IS what QA holds; only ancestry
  differs.
- Single parent `0c9ccc477c`; no MERGE_HEAD (via `git rev-parse --git-dir`);
  `origin/main...main` 0/0; reflog `main@{2}` = "merge origin/main:
  Fast-forward", so main did not author it — QA pushed, main fast-forwarded.
- Provenance QA-reviewed: commit is stamped "By QA.", cites
  `abandoned_commits: [fd785f89ea]`, and BL-1393 has coder/cleaner/architect/
  hardener/documenter evidence files present; QA re-verified on the tip-pure
  branch (compile clean, unit 16/16, property 3/3, shell e2e 11/11, acceptance
  9/9 plus re-tensed BL-658 11/11 and BL-820 12/12).

## Disposition

**No revert, no new ticket, no nudge.** The coordinator received the same
escalation and ruled it in-pane at 23:14 local ("Confirmed — same standing
false-positive class. No revert, no new ticket.") and is closing BL-1393; a
second actor acting would have collided. The predicate fix is the swarm's,
not the operator's. Written untracked, NOT committed — main is the
coordinator's live worktree.

## Re-delivery (operator, 2026-09-04T22:45Z)

The SAME escalation subject `pipeline-code-on-main-8e53a3e853…` was re-emitted
and woke the operator again. Re-verified, not re-derived:

- `is_qa_ancestor.sh 8e53a3e853…` → **rc=1** (unchanged; ancestry-only predicate).
- Flagged paths still byte-identical on `main` and `swarmforge-QA`
  (aaa8789780 / b900f92fdc / e5b2ec5497 spot-checked).

Conclusion unchanged: **false positive**, no action. If this subject fires a
third time, do not re-open it — the babysitter re-emits a standing-class
Article 4.2 flag it cannot clear (BL-247 predicate is ancestry-only).

## Third delivery (operator, 2026-09-04T23:15Z)

Same subject `pipeline-code-on-main-8e53a3e853…` woke the operator a third
time, exactly the case the previous section said not to re-open. Re-confirmed
with the two cheap arms only (a commit object is immutable — nothing was
re-derived):

- `is_qa_ancestor.sh 8e53a3e853…` → **rc=1**, read directly from `$?`
  (not piped — the tail-masks-rc trap).
- **Bounce arm still empty**: 0 hits for `8e53a3e853` under
  `.swarmforge/bounces/` or `backlog/**` outside this evidence directory, so
  the "no" is purely the ancestry arm the BL-1376 tip-pure hand-land route
  guarantees.
- **Content identity re-verified for all seven paths** (not spot-checked this
  time): `main` = `swarmforge-QA` = `origin/main`, blob-for-blob —
  aaa8789780 / b900f92fdc / bbd0611ff4 / 2f394c9cdd / 32ed3e43d5 /
  e5b2ec5497 / 30dcf1f0bd.

**FALSE POSITIVE, NO ACTION.** No revert, no new evidence file (a new one
would inflate the class count), no ticket, no nudge, no NOTIFY, no ASK.

## Fourth delivery (operator, 2026-09-04T23:45Z)

Same sha `8e53a3e853`, same seven paths, verbatim detail string — the fourth
identical delivery (22:17Z / 22:45Z / 23:15Z / 23:45Z). **No action taken.**

The commit object is immutable, so the blob-identity table above was NOT
re-derived. Only the two cheap arms were re-confirmed, both unchanged:

- `is_qa_ancestor.sh 8e53a3e853…` → **rc=1**, read directly from `$?` with
  output redirected to a file (not piped — the tail-masks-rc trap).
- **Bounce arm empty**: 0 hits for `8e53a3e8` under `.swarmforge/bounces/`,
  so the "no" is purely the ancestry arm that the BL-1376 hand-built
  tip-pure land route guarantees by construction.

The **coordinator independently received and dismissed this same delivery
in-pane at 23:45Z** ("Duplicate of an already-confirmed finding (same commit
verified earlier as the standing false-positive class). No new action
needed."), which matches this file's original disposition.

Dedup gap: the coordinator flagged at 23:20Z that this whole batch
(BL-1382 / 1388 / 1393 / 1395 / 1398 / 1399) keeps re-firing unchanged and
that the babysitter sweep likely has a dedup gap. Minting/routing that is the
coordinator's call, not the operator's — nothing was minted or nudged from
here.
