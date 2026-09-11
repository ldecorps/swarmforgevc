# Closing ceremony — shift 2026-09-09 (specifier lean pass, BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-09.json`, `deliveredAt`
2026-09-09T00:00:00Z. Reached the specifier only as the coordinator's
priority-00 note of 2026-09-11T04:25:55Z "Closing ceremony 2026-09-09
ended with NO outcome — FAILED", after the 2026-09-11 ceremony had already
finalized the run (`failedAt: 2026-09-11T00:00:00Z`).

**Outcome of record: `process_ticket`, ref BL-1528 — recorded HERE, not in
the store.** `recordCeremonyOutcome` refuses a run that is no longer
`pending` (`closingCeremonyStore.ts` ~line 92: "already failed, refusing to
overwrite"), so the 2026-09-09 run stays `failed` in
`.swarmforge/lean/ceremony/` and this file plus the ticket are the pass's
durable outcome. Not a silent ceremony twice over.

## Why the packet never arrived

The packet note was never queued: no file under `.swarmforge/handoffs/`
cites `lean/ceremony/2026-09-09.json` (the 2026-09-11 packet's note, by
contrast, is `specifier/inbox/new/00_20260911T042556Z_007787_*`). The bob
mono-router pack live that shift had no specifier window
(`bob-multi-provider-mono-router.conf`, "specifier's window line stays
REMOVED", 26579c166e 09-08 16:40; still absent through the 09-09
provider-exhaustion switch 7715954e26), so `swarm_handoff.sh` refused
`to: specifier` with `Unknown recipient role 'specifier'.` (exit 1).

`runClosingCeremony` writes the run record BEFORE it sends
(`closingCeremonyRun.ts` ~172-176); `sendNoteViaHandoff` throws on the
non-zero exit; the exception skips `writeState` in
`night-closing-ceremony-run.ts`; the next sweep re-runs `lean-packet`,
finds the run (`already_exists`), sends nothing, throws nothing, writes the
state with `lean-packet` done, and stops the swarm. The 2026-09-09 night
state lists `lean-packet` as done and the daemon's 07:54Z run reports
`advanced: false, actions: []`. The same path failed the other way on
2026-09-07 (`closing-ceremony-run-error exit=1 ... HANDOFF SYNC INJECT
FAILED: tmux send-literal failed`, handoffd-failure-20260907T052832Z.log).

The failure note for a stale run (`buildCeremonyFailureNoteDraft`) goes to
the same `to` role by the same throwing path, so an absent specifier hides
the failure for as long as it stays absent. It surfaced on 09-11 only
because the pack in use by then (anthropic mono-router) seats one.

## The signal I acted on

That mechanism — the "a silent ceremony is a failed ceremony" detector
being itself silent — is the process defect of the shift, and it was
unowned: BL-1456 (fold window) and BL-1458 (briefing trigger) touch the
ceremony but neither names delivery. BL-1511 (approved, paused) restores
the specifier seat to the bob pack, which removes THIS trigger but not the
shape: any non-zero `swarm_handoff.sh` exit (09-07's tmux inject) does the
same thing.

Minted **BL-1528** (`type: defect`, `severity: high` — a broken safety
signal): a refused packet send stores the run as failed with the refusal
text, appends `closing-lean-packet-undeliverable <shift>` to the loud log,
returns instead of throwing so the night sequence advances on the first
sweep, and the stale-run failure note gets the same treatment. Feature
`specs/features/BL-1528-an-undeliverable-closing-ceremony-note-is-a-failed-run.feature`,
five scenarios; `human_approval: pending`. Added to epic BL-818's
`decomposes_into`.

## What the packet itself showed, and why it is not the outcome

Path taken QA → cleaner → architect → coder → hardender → documenter; two
closes (BL-1410, BL-1278); no bounces, no skips. Dwell hotspots QA
2098356ms, cleaner 1328047ms. Chases: cleaner ×5, QA ×3, architect ×3,
hardender ×2, documenter ×2 (+1 nudge). Hypotheses: QA dwell; cleaner
chase pattern.

- **Cleaner ×5 / every role chased.** The shift ran on aider/GLM seats
  after the claude weekly limit (coordinator merged "on coder's behalf:
  aider seat cannot self-execute git", 450d9016ef). Chases on every role
  at once are the seat, not a stage; claude seats came back 09-10 and
  BL-1497's role_ask was declared obsolete for the same reason. Nothing to
  ticket.
- **QA dwell.** Highest on every recent shift; QA hand-lands (BL-247) and
  the land-step hazards are owned (BL-1472/1473/1474). No new hypothesis.
- **`qualityRecommendations`.** Advisory; the coordinator's half.
- **Determinism candidates** `pass-bounce-evidence` (0.0127),
  `backlog-promotion` (0.189), `backlog-closure` (0.473): the same three as
  09-06/07/08, still no open `ritual_class:` declarant (BL-1479 declared
  `backlog-promotion` and is in `done/M8/`). Not ticketed, same reasoning
  as the 09-08 pass: each has a shipped helper and
  `promote_and_route_next.sh`'s red fixtures are owned by BL-1480. Expect
  them again; that repeat is the fail-toward-firing posture.
