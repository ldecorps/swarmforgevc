# Article 4.2 escalation: 07c4d372d8 (BL-2108 recruiter prepared-alias steps) — GENUINE, close-out already minted

Adjudicated by the operator at 2026-10-10T12:00Z. **FIRST** delivery of this
subject (exactly 1 CRIT + 1 ESCALATED line in `.swarmforge/babysitterd/babysitterd.log`
at 11:58:57.343Z; 0 prior mentions in `.swarmforge/operator/operator.log`).

## Facts — verified live this run, not recalled

- Commit `07c4d372d83043aecf01eb1a244f5fa3958a8efa`, "Hotfix: BL-2108 step
  handlers gate the weekly recruiter's prepared-alias path", touches ONE
  pipeline file: `specs/pipeline/steps/bl2108RecruiterPreparedAliasSteps.js`
  (1 file changed, 372 insertions, 0 deletions).
- `swarmforge/scripts/is_qa_ancestor.sh 07c4d372d8` exits **1** — NOT a QA
  ancestor. The escalation is **genuine**, none of the known false-positive
  shapes (no main-sync merge, no tip-pure land, no bounce-superseded).
- No waive recorded (`babysitter_waive.bb --record` has not been run for it).
- The swarm ALREADY engaged, within seconds: `backlog/hotfix-ledger.yaml:1724`
  — `state: pending`, `stamp_ticket: BL-2122`, `human_decision: null` — and
  `backlog/paused/BL-2122-stamp-off-hotfix-07c4d372d8-bl2108-recruiter-prepared-alias-steps.yaml`
  exists, minted in commit `168799c443`.
- **Timeline proves the pipeline worked as designed**: hotfix authored
  11:58:27Z (`2026-10-10 12:58:27 +0100`) → stamp-off minted → babysitter CRIT
  11:58:57Z. The alarm fired ~30s after the land, BEFORE a stamp-off review
  could possibly have happened. This is the detector racing the designed
  remedy, not neglect.

## Disposition: note only, no operator action on the tree

Same shape and same ruling as its siblings
`babysitter-article42-1a0d8963a4-stamp-pending-20261010.md`,
`babysitter-article42-bl1166-009daacae7-stamp-pending-20261010.md` and
`babysitter-article42-93a21154d6-qa-ancestor-now-20261010.md`: the ledger entry
+ stamp-off ticket ARE the designed handling path and it is already in motion.
Waiving is the coordinator's call, land-approval is QA's; neither is the
operator's to fabricate.

Explicitly NOT done, and why:
- **No note to the coordinator.** It is already carrying the live stamp-off
  queue (BL-2120 `git_handoff` → coder 40m ago, BL-2121 42m ago) and sent a
  `branch behind 07c4d372d8: in_process work present - merge up` note to coder
  1 min ago, so it has demonstrably seen this commit. A third operator note on
  the Article 4.2 theme would be noise against a 30-second-old ticket.
- **No human notify.** Of 244 ledger entries, ~104 are already
  `awaiting-human`, and a batched approval sweep is OFFERED + unanswered on
  PIPELINE_BOARD. One more per-hotfix ping is noise, not a decision they are
  blocked on.
- **No ASK.** `ask_escalation` reads ok / none pending, and the actionable path
  is inside the swarm, not a fork only the human can resolve.

## Expect re-fires until QA ancestry covers it

The escalation channel reads QA ancestry / waives — not the ledger, and not
this file. Per BL-1404 a coordinator waive does not yet silence the channel, so
the ONLY thing that ends this subject is QA recording the land-approval such
that `is_qa_ancestor.sh 07c4d372d8` exits 0 (BL-1405). Note that this hotfix
(11:58:27Z) POSTDATES the current QA tip `c6ecbacb12` (committer 02:34:07Z), so
merge-base can never succeed by waiting — only a stamp-off review advancing
`refs/heads/swarmforge-QA` over it will do. On a repeat delivery of this
subject: **do not re-derive** — this file is the close-out record.

## Incidental health sweep — all green

- Mono-router topology correct: coder resident UP 2h49m + coordinator UP 2h49m,
  other 6 DORMANT **by design** (not pane loss).
- All 6 daemons UP (handoffd pid 433, supervisor 581, operator-runtime 11455,
  babysitterd 11567 single instance pidfile_alive, tunnel, cloudflared) and all
  3 Telegram processes UP.
- `handoffd.heartbeat` 11:58:56Z — 10s fresh. Handoff traffic 1 min old.
- Pipeline board NOT frozen: `pipelineBoard.lastChangeMs` 11:59:32Z is NEWER
  than the newest `backlog/{active,paused}` mtime 11:58:39Z.
- Provider available. No `closing-ceremony-state.json`, no control-pause.
- backlog active=7 paused=165 — the 10-10 11:19Z promote-duplication is
  CLEARED (`018e3a0f48` removed the stale paused copies, paused 166 → 165), so
  active=7 is now genuine membership, one over its own depth cap of 6. That is
  the coordinator's bookkeeping call, already flagged in the 11:19Z note; not
  re-raised here.
- Unchanged side-note: `role_questions.coder` still `state: escalated` with no
  operator answer path (see memory `no-operator-path-to-answer-a-role-ask`).
