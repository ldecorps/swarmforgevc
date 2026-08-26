# Master-checkout state surfaced by the specifier, 2026-08-19

Found while working the coordinator's `pipeline board hotfixed` note.
Surfaced, not swept (workflow rule: ticket-less changes you did not make
are surfaced). Nothing below is mine except item 4, which is a mistake I
made and am reporting rather than hiding.

## 1. The board hotfix cannot be landed by the specifier — it needs the pipeline

`docs/how-to/BL-848-certify-an-operator-hotfix.md` says a hotfix may be
committed to `main` "or the specifier commits one on the human's behalf",
with a `Hotfix-Certification: pending` trailer. That cannot apply when the
hotfix is in **pipeline code**: `check_pipeline_code_on_main.sh` refused
the commit, correctly, because `extension/src/` may only reach `main` via
QA (Article 1.8/4.2, BL-247).

So the hotfix is specced as **BL-956** (`backlog/paused/`,
`human_approval: pending`) and its diff is captured verbatim at
`backlog/evidence/BL-956-pipeline-board-hotfix.patch` (commit `f2b1a0424`)
so it cannot be lost from the working tree.

The how-to's wording is worth correcting for the pipeline-code case — but
that is a doc change in a file I do not want to touch mid-turn, so it is
noted here rather than done.

## 2. Two ticket-less uncommitted edits still live in the master checkout

Both are in the working tree only, unstaged, and belong to no active
ticket that I can find (`git log` shows no recent commit for either):

- `extension/src/concierge/conciergeTick.ts` — the epic-icon-pool
  exhaustion warning changes from one stderr line per reusing epic to a
  single aggregated line carrying the count and pool size.
- `extension/src/concierge/topicRouter.ts` — a new `reflowSummaryText`
  wraps the `notes` field of a summary body at 72 columns, deliberately
  leaving `approvalContext`/`firstAcceptanceStep` unwrapped.

Neither is described by the human's own evidence note
(`pipeline-board-parked-and-caption-refinement-20260819.md`), which
documents only the three `pipelineBoard.ts` changes. They are explicitly
out of scope for BL-956. They are also pipeline code, so they face the
same problem as item 1: they cannot reach `main` outside QA.

## 3. `backlog/hotfix-ledger.yaml` working tree reverses a ledger state

The working tree has BL-915's entry (`ece61cbe63`, Cursor-bridge
gone-agent session reset) at `state: awaiting-human` where `HEAD` has
`state: stamp-open`. That runs the state machine **backwards**
(`stamp-open` → `awaiting-human` is the transition taken when the stamp
ticket reaches `done`, so this may be legitimate — or it may be a stale
edit about to undo a real progression). Left untouched; the ledger's
durable fields are set by a human/operator, never by me.

## 4. My own error: an over-broad commit pathspec swept three staged files

Committing the hotfix patch I used the pathspec `backlog/evidence/` rather
than naming the file. The master checkout's index already held three
evidence files staged by other roles, so commit `f2b1a0424` carried them
onto `main` as well:

- `backlog/evidence/BL-935-architect-bounce-routing-20260819.md`
- `backlog/evidence/BL-950-architect-pass-20260819.md`
- `backlog/evidence/BL-950-hardener-pass-20260819.md`

All three are additive, append-only review records and nothing was deleted
or overwritten, so I have not tried to undo it — reverting would delete
other roles' evidence, which is strictly worse. Reporting it so nobody is
surprised to find their evidence already on `main`, and so the BL-935 and
BL-950 holders know their records landed early.

## Still staged in the master checkout, untouched by me

`BL-620` (paused→active move), `BL-935` YAML, `docs/reference/Specification.MD`,
`specs/pipeline/steps/bl950QaApprovalEvidenceCommitSteps.js` and the step
registry, `swarmforge/handoff-protocol.md`, the review-forward evidence
gate lib and its two test runners, `docs/briefings/.sent.json` and five
untracked burndown artefacts. None of it is mine and none of it was
touched.
