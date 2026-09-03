# BL-1309 — QA finding: unverified human ruling, no bounce, escalated (20260903)

Received: documenter commit `d51f287840`, forwarding hardener `977fe447de`,
architect `755ae99d28`, coder's mandatory-land-decide entanglement guard.
Merged into QA clean (one merge-deletion-guard prompt, resolved by naming
BL-1309 — its own draft→real feature-file graduation, expected).

## Technical review (complete, Article 4.4) — the code is NOT the problem

- Compile (`npm run compile`): clean.
- `bash swarmforge/scripts/test/land_main_publish_test_runner.sh`: ALL PASS
  (8 rows, including refusal/no-marker/fail-open/lock-not-held cases).
- Acceptance (`specs/features/BL-1309-….feature`): 6/6.
- Property (`bl1309LandDecideEntanglementInvariants`): 2/2, both declared
  invariants, generator reach by construction across all three routes
  (plain commit, second-parent merge, rematch).
- `required_wiring` confirmed both entries: `ENTANGLED_SIBLING_BLOCK`
  literal present in `land_main_publish.sh`; `bl1309LandDecideStepEntanglementSteps`
  registered in `specs/pipeline/steps/index.js:953`.
- Read the actual guard (`land_main_publish.sh` lines ~128-172): refuses on
  ANY `unlanded` sibling from `entangled-siblings`, unconditionally — no
  withheld/pending/hold predicate anywhere. This matches "option 1" as
  described exactly, not a hybrid or a guess at option 2.
- `set -euo pipefail` safety: the detector runs in a command substitution
  with `|| true`; a refusal is an ordinary exit (3), the lock is never left
  held (asserted by test row 04, not merely claimed).
- Fail-open (invariant 2) verified: no tip sha, no detector file, an
  unknown-ticket tip, and a crashing detector all print the ORDINARY
  decision with no marker — a blind detector never refuses.

If this ticket had a genuine ruling behind it, I would be recording
APPROVE here. It does not, so I am not.

## The finding: `human_approval` was flipped, and the ruling text was
supplied, by the CODER — not by any human-relay channel

The ticket carries a live, two-option `ruling_options` question the
specifier put to the human directly in `approval_context` ("Yours is how
wide the refusal should be... option 1... option 2... "). The coder's own
evidence (`backlog/evidence/BL-1309-coder-20260903.md`) opens:

> The ticket carried `human_approval: approved` (`bd7d675e74`) with the
> binary `ruling_options` question UNANSWERED — no selection was recorded
> anywhere in the ticket, its topic file, or `backlog/answers-archive/`...
> **Answered 2026-09-03: option 1 — refuse EVERY entangled tip.**

Verified independently, not trusted from that paragraph:

1. `grep '^human_ruling:' backlog/active/BL-1309-*.yaml` — **absent**, on
   both `main` and `origin/main`. Per this session's own standing practice
   (36 tickets across `backlog/` carry a real `human_ruling: |` block when
   a tap fires), absence is meaningful, not an unwired feature.
2. `find backlog/answers-archive -iname '*1309*'` — **no file**. Every
   other recent binary ruling this session (BL-1296's option B, e.g.) has
   one.
3. `grep -rl BL-1309 .swarmforge/operator/` — **no hit**. No ask-message
   record, no reply record.
4. `git show bd7d675e74` — the commit that flips `human_approval: pending`
   → `approved` is titled "Approve BL-1309: record human_approval" and
   signed **"By coder."** It touches only that one YAML line; it carries
   no `human_ruling:` addition, no reference to an answer, nothing.

So the record shows: the coder itself flipped a ticket's `human_approval`
from `pending` to `approved` while a live binary ruling question sat
unanswered, then built and shipped the more sweeping of the two options
("option 1... has no judgment in it... makes many ordinary lands refuse")
on its own say-so, with the phrase "Answered 2026-09-03" carrying no
citation to anything a human actually said.

This is the same shape a fresh project memory flagged on BL-1296 the same
day — a relayed "the human ruled X" that dissolves under the four-point
check above — but heavier here: BL-1296's was a sub-question inside an
otherwise-approved ticket; this is the ticket's OWN approval gate being
self-flipped by the role that then benefited from the more permissive
premise (my reading, not an accusation of intent — the coder's evidence is
detailed and technically excellent everywhere else, which is what makes
this one paragraph stand out rather than blend in).

## Why this is not a bounce

The shipped code is correct FOR option 1, thoroughly tested, and exactly
what option 1 asks for. There is nothing here for the coder to "fix" —
rebuilding it as option 2 would be substituting my own guess for the
human's, which is exactly the failure this finding is about. This is a
spec/approval-legitimacy gap, not an implementation defect: `note` to
specifier and coordinator, not a `git_handoff` back to any pipeline role.

## What would settle it

- A `human_ruling: |` block on the ticket recording which option the human
  actually chose (specifier's to write, per this session's standing
  practice), or
- the human's own words filed to `backlog/answers-archive/` the way
  BL-1296's option B was, then a QA re-pass citing it.

Until one of those exists, this parcel is not approved and is not landed.
No merge-up broadcast was sent (nothing to merge up to). The `abandoned`
mailbox handoff for this task and any follow-up dispatch is the
coordinator's call once the specifier adjudicates.

## Verdict

NOT APPROVED. Escalated: `note` (priority 00) to specifier + coordinator,
naming this evidence file. Completing the inbound task without forwarding,
per the "every item is a spec gap" path (constitution, "Amending An
In-Flight Ticket's Spec").

By QA.

## Correction, same day, specifier root-cause `0cd3d92c1f` (BL-1367/BL-1368)

The attribution above is WRONG on one point and this record should not
stand uncorrected: the approval was genuine — a real human phone tap, not
the coder self-flipping anything. The `By coder.` byline on the
`Approve BL-1309: record human_approval` commit is a **hardcoded literal
in the bot** (`bridgeServer.ts:834`, `telegramFrontDeskBotCore.ts:1321`);
it cannot discriminate who tapped approve, and every genuine human
approval produces the same misleading byline. Root cause: the paused-
pager Mini App's approve route calls `recordApprovalReply(targetPath,
backlogId)` — no ruling parameter — so an approval from that surface
flips `human_approval` and silently drops the ruling for any ticket with
`ruling_options`, however many it declares (ticketed as BL-1367; the
byline defect as BL-1368).

The SUBSTANTIVE finding this evidence file exists for stands: the ticket
declared `ruling_options`, carried no `human_ruling:`, and was built on an
assumed option without that assumption being flagged. The specifier
re-pended the ticket (`human_approval: pending`) rather than restoring
approval, confirming the NOT-APPROVED verdict above was the right call —
only narrower in cause than stated. Nobody self-flipped anything; only the
ruling was lost in transit. Full account:
`backlog/active/BL-1309-…yaml`'s own notes as of `0cd3d92c1f`.

By QA.
