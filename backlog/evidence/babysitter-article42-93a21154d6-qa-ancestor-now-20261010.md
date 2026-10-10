# Article 4.2 escalation: 93a21154d6 (Mini App pane history) — GENUINE at fire time, NOW self-closed by QA ancestry

Adjudicated by the operator at 2026-10-10T05:05Z. FIRST delivery of this
subject (no prior mention in `operator.log`; dedup stamp
`pipeline-code-on-main-93a21154d6…` = 2026-10-10T04:57:22Z).

## Facts

- Commit `93a21154d688e9f2ca15a426ce2afecb4f118456`, "Hotfix: Mini App retains
  pane history past the alt-screen frame and Expand opens on the live tail",
  authored 2026-10-10T04:28:35Z, touches 6 pipeline files under
  `extension/src/bridge/`, `extension/src/panel/` and `extension/test/`.
- `swarmforge/scripts/is_qa_ancestor.sh 93a21154d6` now exits **0**. No
  `approved:` stderr line — it passed on the plain ancestry branch, i.e.
  `git merge-base --is-ancestor <sha> refs/heads/swarmforge-QA` succeeds.
- **Why it succeeds: a QA branch take-up, not a review.**
  `refs/heads/swarmforge-QA` is `ceb99d05ce` ("Promote BL-1981: paused →
  active for coder"), author date 2026-10-05, but **committer date
  2026-10-10T05:04:05Z** — QA replayed its branch onto current `main`
  ~1 minute before this adjudication. Every hotfix on `main` became a QA
  ancestor in that one act: `1a0d8963a4` and `009daacae7`, which exited **1**
  at 02:28Z (see their sibling evidence files), both exit **0** now too.
- No waive recorded for any of the three (`babysitter_waive.bb --record` not
  run), and none was needed.
- The designed handling path is already in motion and complete on the swarm's
  side: `backlog/hotfix-ledger.yaml` entry 245 names this commit —
  `state: pending`, `stamp_ticket: BL-2120`, `human_decision: null` — and
  `backlog/paused/BL-2120-stamp-off-hotfix-93a21154d6-miniapp-pane-history.yaml`
  exists (minted in `82eeed5d5f`).

## Disposition: note only, no operator action

Nothing to nudge. The escalation channel reads the ancestry predicate, which
now answers approved, so **this subject will not re-fire** — and neither will
the two 02:28Z siblings. The operator does not approve, waive, or land; the
ledger + stamp ticket are the correct and already-running path, and the
decision on BL-2120 stays the human's.

## The correction this file carries

Its siblings predicted "expect re-fires until QA acts". QA did act — but by
taking `main` up into its own branch, not by reviewing these hotfixes. Read
that generally:

> **A QA branch take-up of `main` silences Article 4.2 for every hotfix
> already on `main`, in one stroke. "The escalation stopped" is therefore NOT
> evidence that a hotfix was reviewed.**

That is precisely the shape
`babysitter-article42-a7c3ef9974-main-sync-merge-false-positive-20260907.md`
documents, seen from the other side: there it produced a false escalation,
here it retires three true ones. The only surviving record that these three
hotfixes are unreviewed is the ledger's `human_decision: null` plus the
BL-2109/2111/2115/2120 stamp tickets — not the escalation channel.

## Swarm health at this run (incidental, all green)

8 seats + babysitterd (pid 4414, uptime 5h27m) UP; `handoffd.heartbeat`
2026-10-10T05:05:02Z (fresh); last handoff 11m ago (coordinator → hardender);
backlog active=6 paused=167 done=932. No stall, no nudge sent.

---

## CORRECTION, 2026-10-10T05:40Z — the prediction above is falsified

This file predicted "this subject will not re-fire". It re-fired ~28 minutes
later, and the reasoning was wrong in a way worth naming:

- `is_qa_ancestor.sh 93a21154d6` now exits **1** again. The QA branch take-up
  of `main` that produced exit 0 at 05:04Z **was undone**:
  `refs/heads/swarmforge-QA` was `ceb99d05ce` (committer 05:04:05Z) at the
  time of writing; it is now `c6ecbacb12` ("BL-2111: stamp-off review of
  hotfix 009daacae7", committer 2026-10-10T02:34:07Z). QA rebuilt its branch
  from a point that predates the take-up, discarding it.
- So the escalation is **genuine**, not retired, and will keep re-firing.

> **Generalize:** a QA-ancestry exit 0 obtained via a branch take-up is
> NOT durable state. QA rewrites its branch routinely (stamp-off reviews land
> on it), and any take-up of `main` is lost at the next rewrite. Never record
> "will not re-fire" off a single ancestry read — re-run
> `is_qa_ancestor.sh` at **every** delivery of the subject.

## Current measured state of the four open hotfixes

| commit | `is_qa_ancestor.sh` | stamp ticket | status |
|---|---|---|---|
| `1a0d8963a4` | exit 0 | BL-2109 | genuinely closed out (review landed on QA) |
| `009daacae7` | exit 0 | BL-2111 | genuinely closed out (`c6ecbacb12`) |
| `93a21154d6` | exit 1 | BL-2120 | `backlog/paused/`, close-out UNRECORDED |
| `b24cc182e5` | exit 1 | BL-2121 | `backlog/paused/`, close-out UNRECORDED |

The two that closed out did so by the designed path — the stamp-off review
ticket was promoted, worked, and landed on `swarmforge-QA` — not by a take-up.
That is the path the remaining two still need. Ledger entries for both read
`state: stamp-open`, `human_decision: null`.

## Operator action taken this run

Note only, no approval/promote/waive. The real finding of the 05:40Z run was
unrelated and more urgent: the **coordinator was halted by the loop detector**
with an undelivered QA note aging in its inbox. One sync-injected nudge
(`inject_note_to_role.sh`, `sync-deliver outcome=ok` 05:37:09Z) restarted it,
pointing at
`.swarmforge/operator/NOTE-coord-unstick-20261010T0540.md`, which carries
these ancestry facts so the coordinator can promote BL-2120/BL-2121 or record
a waive. That decision remains the coordinator's / QA's / the human's.

---

## THIRD delivery, 2026-10-10T06:04Z — ancestry re-run, state unchanged

Per the correction above, `is_qa_ancestor.sh` was re-run rather than trusted:

| commit | `is_qa_ancestor.sh` | stamp ticket | ledger |
|---|---|---|---|
| `93a21154d6` | exit **1** | BL-2120 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |
| `b24cc182e5` | exit **1** | BL-2121 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |

`refs/heads/swarmforge-QA` is still `c6ecbacb12` (committer 2026-10-10T02:34:07Z)
— the discarded take-up has not come back. So the escalation remains **genuine**
and will keep re-firing until a stamp-off review lands on the QA branch
(QA's call, per BL-1405) or a waive is recorded (`babysitter_waive.bb --record`,
the coordinator's call). Operator action this run: none — no approve, promote,
waive or commit. The facts were already delivered to the coordinator at 05:43Z
via `NOTE-bl2108-gate-20261010T0542.md`; re-sending them would be a blind
re-nudge.

## The run's real finding: a THIRD loop-wedge, in a NEW shape, that self-cleared

The sweep behind this re-fire caught the coordinator wedged a third time
(after 05:28Z and 05:42Z) — but not in the banner shape:

- **Shape:** a true **modal dialog**, not a halt banner — `?  A potential loop
  was detected ... Do you want to keep loop detection enabled or disable it for
  this session?` with `› 1. Keep loop detection enabled (esc)` /
  `2. Disable loop detection for this session`. No countdown line, no spinner,
  frozen token counter — i.e. it passed every genuine-block tell.
- **Trigger:** four identical
  `Read specs/pipeline/steps/bl2108RecruiterPreparedAliasSteps.js (lines 69-83)`
  — the same BL-2108 unsatisfiable-gate loop diagnosed at 05:46Z.
- **Dispatch was genuinely frozen:** 5 parcels in `inbox/new/`, the 04:45:23Z
  QA note at `chaseCount: 11` (it was 6 at the 05:39Z run), one parcel held in
  `in_process/`, and no parcel consumed since the 05:57:59Z `sync-deliver`.
- **It self-cleared mid-run, without operator action.** A chase at
  06:05:24Z restarted the agent process: by 06:07Z the pane showed a fresh
  Qwen Code splash, context 10.8%, card re-read, `ready_for_next.sh` run, the
  held BL-2108 parcel re-served, `Working... 41s`.

### Two rules this adds

> **1. The loop-halt has a second shape, and it forbids the usual lever.** The
> banner shape leaves a free prompt, so `inject_note_to_role.sh` works. The
> **modal** shape does not: inject is a *sync tmux injection*, so injecting
> while a dialog is open types into the dialog and answers it blind. When the
> pane is on a modal, the human is the only lever — never inject.

> **2. Recapture before spending the ask slot, even on a dialog that passes
> every genuine-block tell.** This one had no countdown, so the known
> self-clearing flavour was correctly ruled out — and it *still* self-cleared,
> by a route that flavour does not describe: a **chase-triggered process
> restart**. Two captures ~3 minutes apart turned a would-be `operator_ask`
> (a 2-option native poll, drafted and not sent) into no action at all.

**Residual risk, recorded not actioned:** the fresh session re-serves the same
BL-2108 parcel with 10.8% context, so it can re-enter the same gate loop. The
gate facts are still queued for it as a note parcel in `inbox/new/`, which it
reaches after completing the in_process parcel. No nudge now — the pane is
mid-turn, and a bare resume nudge walks back into the halt.

## Swarm health at this run (all green)

2 standing sessions correct under mono-router (resident `swarmforge-coder`
hosting **documenter**, 1m38s into BL-1885 doc updates, ctx 58.9% — untouched;
6 DORMANT by design); all 6 daemons UP (handoffd 4309, heartbeat
2026-10-10T06:04:15Z fresh; babysitterd pid 4414 up 6h26m, single instance —
TRUSTED, `start_babysitterd.sh` not run); Telegram bridge UP; provider
available; HEAD `218a64da8d` (04:37:33Z UTC, +01:00 converted per BL-482);
backlog active=6 paused=167 done=940; `pipelineBoard.lastChangeMs` 05:57:43Z,
NEWER than the newest `backlog/` mtime (05:37:23Z) — board not frozen.

---

## FOURTH delivery, 2026-10-10T06:34:39Z — ancestry re-run, state still unchanged

Re-run rather than trusted, per the correction above:

| commit | `is_qa_ancestor.sh` | stamp ticket | ledger |
|---|---|---|---|
| `93a21154d6` | exit **1** | BL-2120 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |
| `b24cc182e5` | exit **1** | BL-2121 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |

`refs/heads/swarmforge-QA` is still `c6ecbacb12` (committer 2026-10-10T02:34:07Z);
the discarded 05:04Z take-up has not returned. Escalation remains **GENUINE**;
the Article 4.2 close-out for both hotfixes is still **UNRECORDED**. The facts
reached the coordinator at 05:43Z and again at 06:13:38Z, so a third send would
be a blind re-nudge. Operator action on the escalation itself: none — no
approve, promote, waive or commit.

## The run's real finding: a FIFTH loop-wedge, modal shape, one step from the exit

The sweep caught the coordinator wedged a **fifth** time (05:28Z banner, 05:42Z
banner, 06:06Z modal, 06:10Z banner, now ~06:36Z modal) — same BL-2108
unsatisfiable-gate root cause diagnosed at 05:46Z.

What makes this one different, and worth the human's attention:

- **My 06:12Z exit note WORKED.** The coordinator's own last reasoning line,
  still on the pane above the dialog, reads: *"The exit note at 06:12Z already
  gave the definitive answer: BL-2108 is a deadlock caused by a code defect in
  the gate, and the satisfiable exit is to send a git_handoff for task:BL-2108
  citing commit:2e11b8cd89, then run plain done_with_current.sh. **Let me
  execute that.**"* The loop detector fired at precisely that point. The agent
  is not confused any more — it is **one keystroke from the correct exit**.
- It had already produced the 06:15:17Z commit `d3429fb865` (BL-2108
  base_commit pointer) off that note, so the note demonstrably moved it.
- **Shape is MODAL, so the operator's lever is forbidden.** `? A potential loop
  was detected … › 1. Keep loop detection enabled (esc) / 2. Disable loop
  detection for this session`. Per the 06:09Z rule, `inject_note_to_role.sh` is
  a *sync tmux injection*: injecting here types into the dialog and answers it
  blind. Not done.

### A measurement correction worth keeping

`handoffd.log` at 06:37:22Z logged `closing-context-clear-skip-fullness
coordinator 5.0%`, and a `capture-pane` taken in the same seconds came back
**blank**. Both looked like a fresh session (the pane footer had read
`Context 53.8% used` ~1 minute earlier). Neither was:
`tmux list-sessions` shows `swarmforge-coordinator created=Sat Oct 10 05:58:26
2026` LOCAL = **04:58:26Z**, i.e. the same 1h39m-old session, never restarted.

> **The modal's box art covers the pane footer, so handoffd's context-fullness
> parse misreads it (5.0% here) and a capture taken mid-redraw returns empty.
> A sudden context drop plus a blank capture is evidence of a DIALOG, not of a
> session restart.** Check `list-sessions -F '#{t:session_created}'` before
> concluding a seat was replaced.

## Why this run escalates to the human

Five wedges in ~70 minutes, all one root cause, and every lever available to
the operator is now exhausted or forbidden:

- The inject lever is **forbidden** on a modal (types into the dialog).
- Chase-restart is **a cycle, not a recovery** while the gate stands (06:15Z
  finding): it re-serves the same parcel and re-wedges minutes later.
- The durable fix is **real application code** —
  `work_note_evidence_lib.bb:69` clause 2 `(and (some? reason)
  active-on-main?) -> :refuse-active-on-main` never consults `evidenced?`, and
  `done_with_current_task.bb:200` disqualifies main-reachable commits so
  `2e11b8cd89` can never count. The operator does not edit code, and **no
  backlog ticket covers this defect** (checked `backlog/{active,paused,done}`),
  while the specifier is DORMANT under mono-router and cannot self-serve.

So: ONE notify, bundling the keystroke, the missing ticket and the Article 4.2
state. No ASK — the human is the lever, and their answer is not something the
operator needs in order to act.

## Swarm health at this run (green apart from the wedge)

2 standing sessions UP uptime=1h 36m, correct under mono-router (resident
`swarmforge-coder` hosting **coder**, 3m46s into the BL-2116 killed-probe
feature test, ctx 38.4%, forward-moving — untouched); 6 DORMANT by design. All
6 daemons UP: handoffd pid 8438 (restarted ~06:26Z, sweeps running normally at
06:37:23Z, heartbeat 06:35:16Z fresh), handoffd-supervisor 8540,
operator-runtime 4961, babysitterd **pid 4414 up 6h57m, single instance,
watchdog `state: healthy` / `pidfile_alive: true` — TRUSTED,
`start_babysitterd.sh` NOT run**, vscode-tunnel, bubble-cloudflared. Telegram
bridge UP (3 processes). Provider available. HEAD `d3429fb865` @06:15:17Z UTC
(+01:00 converted per BL-482). Backlog active=6 paused=167 done=940.
`pipelineBoard.lastChangeMs` 06:32:04Z with no `backlog/` file touched in 120
min — board NEWER than backlog activity, so **not frozen** per the mismatch
rule. Coordinator mailbox new=6 in_process=1 with every `.chase.json` sharing
`lastChasedAtMs` 06:10:42Z — consistent with babysitterd's own 06:34:39Z
`NUDGE-SKIP coordinator busy — pane mid-turn`, i.e. chases suppressed by a
busy seat, not a dead chase loop. The 04:45:23Z QA note is the oldest stranded
item at `chaseCount: 12`.

---

## FIFTH delivery, 2026-10-10T07:05:13Z — ancestry re-run, state STILL unchanged

Re-run rather than trusted, per the standing correction above:

| commit | `is_qa_ancestor.sh` | stamp ticket | ledger |
|---|---|---|---|
| `93a21154d6` | exit **1** | BL-2120 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |
| `b24cc182e5` | exit **1** | BL-2121 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |

`refs/heads/swarmforge-QA` is still `c6ecbacb12` (committer 2026-10-10T02:34:07Z);
the discarded 05:04Z take-up has not returned. Escalation remains **GENUINE**, the
Article 4.2 close-out for both hotfixes is still **UNRECORDED**, and the designed
path (promote the stamp-off ticket so QA's review lands on the QA branch, per
BL-1405 — or record a waive, the coordinator's call) has not moved. The facts
reached the coordinator at 05:43Z and 06:13:38Z and the human at ~06:40Z; a third
send would be a blind re-nudge. Operator action on this escalation: **none** — no
approve, promote, waive, commit or code edit.

**The wedge streak has ENDED.** The five loop-halts of 05:28–06:36Z are over: both
standing sessions were reborn at 06:49:55Z (`t:session_created` = Sat Oct 10
07:49:55 LOCAL) and both are forward-moving at this sweep, with no banner and no
modal on either pane. Nothing to unstick.

---

## The second event this run: `seat-stuck-documenter` (BL-1885) — FALSE on its premise

**FIRST delivery of this subject** (`grep -c seat-stuck-documenter operator.log` = 0).
Detail: *"documenter has held BL-1885 with no commit since the claim: no commit for
61m (threshold 60m)"*. Falsified before any clock arithmetic, by the check's own
input: `check-seat-ticket-stuck` consumes `held-seat-tickets`, which is a glob over
**`*/inbox/in_process/*`** parcels.

- `find .swarmforge/handoffs -path '*/inbox/in_process/*' -name '*.handoff'` returns
  **exactly one** parcel, and it is the coordinator's own
  `00_20261010T042938Z_017809_from_coordinator_to_coordinator`. There is **no
  documenter parcel in_process anywhere.**
- `.swarmforge/handoffs/` holds only `coder/`, `coordinator/`, `specifier/` (plus the
  shared `inbox/`, whose `new/` is 2026-07-09 relics and whose `in_process/` is
  empty). **The documenter has no mailbox directory at all** under mono-router — so
  there is no place for a held claim to live.
- `.worktrees/documenter` is **clean** (`git status --short` empty) at
  `c452fff615` (2026-10-10T04:52:13Z UTC, +01:00 converted per BL-482). Nothing
  uncommitted, nothing lost.
- `./swarm status`: documenter is **DORMANT by design** (mono-router; only the
  resident + coordinator hold standing sessions). It has had no `sync-deliver` since
  2026-10-09T10:22:07Z.
- Both sessions were born **06:49:55Z — 15 minutes before the CRIT** — so the 61m
  dwell is measured across a seat replacement. This is the **fourth** instance of the
  "clock spans a relaunch" shape today (previous: 04:50Z, seat-stuck-coordinator).

So the clock measured a claim that was consumed when the rotation router moved the
resident seat off documenter and onto coder, and the CRIT describes a seat that no
longer exists.

### The one residual that is NOT a false positive, and why it still needs no nudge

BL-1885 has genuinely completed `coder` (`447b586f41` 02:52:16Z), `architect`
(`1784cce280` 02:56:53Z) and `hardender` (`d212ba8757`/`b340afb56a`/`c452fff615`,
04:29–04:52Z) of `required_stages: [coder, architect, hardender, documenter, qa]`.
Its **documenter stage has no parcel in flight** — the 06:02Z hold ended without a
commit — and the ticket still reads `status: todo`, `assigned_to: coder`.

That is a re-dispatch decision, which is the **coordinator's** to make, not the
operator's. And it does not meet the stall test:

- The coordinator is **awake and mid-turn** (`Working... 6m 14s`, ctx 58.5%),
  reasoning about promoting BL-2108 — not halted, no dialog.
- The resident (hosting **coder**) is **mid-turn** (`Working... 4m 2s`, ctx 48.0%),
  writing a `git_handoff` for `task: BL-2116` / `commit: 07c020ee0a` to QA.
- Inboxes are **not** empty: coordinator `new=6`, `in_process=1`.

"All agents idle + inboxes empty" is the dispatch-gap precondition, and none of it
holds. One nudge now would land on a busy pane and, on this coordinator, risks
re-opening the loop halt. **No nudge, no pull, no ticket move, no split note.**

## Swarm health at this run (green, with one carried-over concern)

Both standing sessions UP uptime=16m (correct under mono-router: resident
`swarmforge-coder` hosting **coder**; 6 DORMANT by design). All 6 daemons UP:
handoffd 15405, handoffd-supervisor 17456 (verified via `/proc`, exactly one of
each — no duplicate pileup), operator-runtime 4961, babysitterd **pid 4414 up
7h28m, single instance, watchdog `state: healthy` / `pidfile_alive: true` —
TRUSTED, `start_babysitterd.sh` NOT run**, vscode-tunnel, bubble-cloudflared.
Telegram bridge UP (3 processes). Provider available. `handoffd.heartbeat`
2026-10-10T07:05:05Z (14s fresh). HEAD `d3429fb865` @06:15:17Z UTC; the coder's
own tip `07c020ee0a` is newer and about to hand off, so HEAD's 50m age is queueing,
not stalling. Backlog active=6 paused=167 done=932.
`pipelineBoard.lastChangeMs` 07:05:52Z vs newest `backlog/` mtime 06:39:11Z — board
**newer** than backlog activity, so not frozen per the mismatch rule.

**Carried-over concern, deliberately NOT re-notified:** the `start_handoff_daemon`
churn reported to the human at 07:01:11Z is still running — 07:00:21Z, 07:00:48Z,
**07:06:42Z and 07:09:32Z**, the last two *after* that notify, all `caller=unknown`.
Exactly one handoffd + one supervisor are live, so it is serial restart churn, not a
fan-out, and both seats are progressing through it. A second notify five minutes
later would carry no fact the first did not; the code fix (start mutex/debounce +
`DAEMON_START_CALLER` label) was already asked for there.

---

## SIXTH delivery, 2026-10-10T07:35:53Z — ancestry re-run, state still unchanged

Re-run rather than trusted, per the standing correction above:

| commit | `is_qa_ancestor.sh` | stamp ticket | ledger |
|---|---|---|---|
| `93a21154d6` | exit **1** | BL-2120 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |
| `b24cc182e5` | exit **1** | BL-2121 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |

`refs/heads/swarmforge-QA` is still `c6ecbacb12` (committer 2026-10-10T02:34:07Z);
the discarded 05:04Z take-up has not returned. The escalation remains **GENUINE**
and the Article 4.2 close-out for both hotfixes is still **UNRECORDED**. Operator
action on the escalation itself: **none** — no approve, promote, waive, commit or
code edit. The facts reached the coordinator at 05:43Z and 06:13:38Z and the human
at ~06:40Z; a fourth send would be a blind re-nudge.

## The run's new fact: the close-out is BLOCKED BY DESIGN, not by neglect

Five prior deliveries recorded "the designed path has not moved" without being able
to say why. This run can: **a closing ceremony is mid-flight with promotion frozen.**

`.swarmforge/daemon/closing-ceremony-state.json`:
`nightKey 2026-10-10`, `phase: briefing`, `sequence: [freeze-promotion, lean-packet,
rotate-documenter]`, `rotationRequested: true`, `parked: false`, `hadInFlight: false`;
`startedAtMs` = **07:11:02Z**, `drainDeadlineMs` = **07:36:02Z** (passed 1.3m ago),
`hardDeadlineMs` = **07:45:00Z** (~7m away). `closing-ceremony-run` logs
`advanced: false, actions: []` each sweep.

`freeze-promotion` is the first element of that sequence, so **BL-2120/BL-2121
cannot be promoted while the ceremony holds** — promotion is the very thing frozen.

> **Generalize: before reading an unmoved stamp-off ticket as coordinator neglect,
> check `closing-ceremony-state.json` for `freeze-promotion`. During a ceremony the
> designed close-out path is unavailable by construction, and the correct operator
> action is to wait for the hard deadline, not to nudge the coordinator toward a
> promote it is forbidden to perform.**

The ceremony also explains the apparent dispatch gap, which earlier runs would have
read as a stall: it drains in-flight work before `rotate-documenter`, which is why
`hadInFlight: false` and why nothing has been served since the 05:57:59Z
`sync-deliver`. Nothing is broken, and the runtime force-advances at 07:45:00Z.

### Two measurement corrections from this run

> **1. `ls | wc -l` on an inbox over-counts ~2x — `.chase.json` sidecars.** A first
> read gave coordinator `new=13` and looked like an inbox climbing from the 07:05Z
> `new=6` (the loop-halt tell). `ls` excluding `*.chase.json` shows **6 real parcels
> plus one Aug-25 `.handoff.dead` relic** — i.e. *unchanged*, not climbing. Count
> `*.handoff` only, or the dominant halt tell fires on arithmetic.

> **2. A frozen `lastChasedAtMs` with no `sync-deliver` is NOT a halt here.** All six
> parcels share `lastChasedAtMs` 07:10:42Z and the oldest (the 04:45:23Z QA note) is
> at `chaseCount: 16`. That timestamp sits ~20s *before* the coordinator's current
> session was born (`t:session_created` = Sat Oct 10 08:15:26 LOCAL = **07:15:26Z**),
> so the chase clock spans a seat replacement — the fifth instance of the
> "clock spans a relaunch" shape today.

**The wedge streak remains ended.** Neither standing pane shows a banner or a modal.
`closing-context-clear-skip-fullness coordinator 6.0%` in `handoffd.log` disagrees
with the pane footer's `55.3% used`, but per the 06:37Z rule the falsifier is
`t:session_created`, which shows the same 07:15:26Z session throughout — a parse
artefact, not a restart.

## Swarm health at this run (all green)

- **Seats:** 2 standing sessions UP, correct under mono-router — coordinator
  (uptime 20m 46s, born 07:15:26Z, idle at a clean prompt having completed its
  ceremony duties) and resident `swarmforge-coder` (uptime 46m 17s, born 06:49:55Z)
  **hosting documenter** and forward-moving: it committed `4b95ce6f49` on
  `swarmforge-documenter` ("BL-1885: documenter handoff — no docs affected,
  forwarding to QA"). 6 seats DORMANT by design.
  - This **closes the one residual** flagged at 07:05Z: BL-1885's documenter stage
    had no parcel in flight and the ticket read `status: todo`. The stage has now
    produced its commit and is forwarding to QA, with no operator nudge — correctly
    left to the coordinator, and it resolved itself.
- **Daemons:** all 6 UP — handoffd pid 15628 (uptime 25:08, exactly one instance),
  handoffd-supervisor 15725, operator-runtime 4961, babysitterd **pid 4414 up
  07:58:11, single instance, watchdog `state: healthy` / `pidfile_alive: true` —
  TRUSTED, `start_babysitterd.sh` NOT run**, vscode-tunnel, bubble-cloudflared.
  Sweeps cycling normally (full sweep list at 07:36:38Z); `handoffd.heartbeat`
  2026-10-10T07:35:53Z (fresh). Telegram bridge UP (3 processes). Provider available.
- **Git:** HEAD `d3429fb865` @ 06:15:17Z UTC (+01:00 converted per BL-482). Its 80m
  age is ceremony hold plus the resident's work sitting on `swarmforge-documenter`,
  not a stall.
- **Backlog:** active=6 paused=167 done=932. `failed/` empty; `dead-letter-notify`
  reports `no-new-dead-letters`.
- **Pipeline board:** `pipelineBoard.lastChangeMs` 07:32:21Z vs newest `backlog/`
  mtime 06:15:11Z UTC — board **newer** than backlog activity, so not frozen per the
  mismatch rule.
- **Asks:** `ask_escalation` ok, no question awaiting escalation. `role_questions.coder`
  remains `escalated` (05-21 vintage) — a role ask with no operator answer path.

**Carried-over concern, still deliberately NOT re-notified:** handoffd restarted once
more since the 07:05Z run (pid 15405 → 15628, ~07:12Z). Exactly one handoffd and one
supervisor are live and sweeping, so it stays serial restart churn rather than a
fan-out. The fact and the code fix (start mutex/debounce + `DAEMON_START_CALLER`
label) were already given to the human at 07:01:11Z; a third notify would carry
nothing new.

## Disposition: note only

No nudge (the resident is mid-work and the coordinator is forbidden to promote during
the freeze), no notify (no new fact the human lacks), no ASK (no decision of theirs
is blocking me), no commit, no code edit.

## SEVENTH delivery, 2026-10-10T08:06:12Z — GENUINE, and the re-fire finally has a cause

Re-run rather than trusted, per the standing correction above:

| commit | `is_qa_ancestor.sh` | stamp ticket | ledger |
|---|---|---|---|
| `93a21154d6` | exit **1** | BL-2120 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |
| `b24cc182e5` | exit **1** | BL-2121 (`backlog/paused/`) | `state: stamp-open`, `human_decision: null` |

`refs/heads/swarmforge-QA` is still `c6ecbacb12` (committer 2026-10-10T02:34:07Z).
Escalation **GENUINE**, Article 4.2 close-out still **UNRECORDED**. Operator action
on the escalation: **none** — no approve, promote, waive, commit or code edit.

### Why this delivery reached the OPERATOR and not the coordinator

Six prior runs could not say why the subject kept arriving. This one can, and it is
not about ancestry at all. `babysitterd.log` at 08:06:12Z:

```
REPAIR [no-socket] swarmforge-coder
REPAIR [no-socket] swarmforge-coordinator
CRIT [pane-coder] / [pane-coordinator] tmux session missing
CRIT [handoffd] handoffd.bb not running
CRIT [pipeline-code-on-main-93a21154d6…]
NUDGE-SKIP no tmux socket or role "coordinator" in roles.tsv
```

> **The escalation channel nudges the coordinator when it can, and escalates to the
> operator when it cannot. `NUDGE-SKIP no tmux socket` is the switch.** So an
> Article 4.2 subject lands on the operator *because the swarm was down at sweep
> time*, not because the subject got worse. Six of today's seven deliveries pair
> with a window where the pack was absent or restarting.

### The ceremony stopped the pack, and babysitterd put it back

- 07:46:12Z — the ceremony force-advanced past `hardDeadlineMs` (07:45:00Z) through
  `briefing-missing` → `swarm-stopped`. `closing-ceremony-loud.log` logs
  `closing-briefing-missing`; `kill-all-audit.log` ends `kill_all_swarm SUCCESS —
  clean slate`, having killed both sessions, run `tmux kill-server` and **cleared
  `tmux-socket` and `sessions.tsv`**. `closing-ceremony-state.json` is now
  `phase: done`.
- 08:06:12Z — babysitterd read that deliberate stop as a fault: `REPAIR [no-socket]`.
- 08:07:02Z — `daemon-start-audit.log`: `start_handoff_daemon invoked …
  caller=swarmforge.sh` — a **full pack relaunch**. `start-swarm-launch.log` ends
  "SwarmForge is ready" (clean; no staffing-gate refusal).

> **Rule: babysitterd does not honour the closing ceremony's `swarm-stopped`.** The
> ceremony's own teardown deletes the socket, which is exactly the signal
> babysitterd repairs from, so a deliberate stop is reliably undone ~20 minutes
> later. `control-pause.json` is the hold that would prevent it, but
> `wait_for_expedite_then_bedtime.sh` arms it **only when an expedite is in
> flight** — there was none, so nothing told babysitterd the stop was intentional.

### Why that relaunch was benign — in fact load-bearing

The scheduled weekend bedtime is mid-flight: `0 9 * * 0,6
wait_for_expedite_then_bedtime.sh` (Sat 09:00 local = 08:00Z), pids 4636/4640/4921
live, now at **step 3, soft drain**, logging `still documenter:in_process=1` every
15s into `.swarmforge/operator/day-shift.log`. Its ceiling is 4h (`timeoutMs`
default 14400000), after which it prints `forced` and proceeds to `finish-shift`.

That drain waits on a real parcel —
`00_20261010T045258Z_001754_from_hardender_to_documenter_for_documenter.handoff`,
claimed 04:52:58Z (~3h18m), with a `.nudge` sidecar. **No dormant seat can clear
it.** Had babysitterd honoured the stop, the drain would have burned its full 4h
ceiling with no seat alive to forward the parcel. Because the pack is back, the
resident is clearing it right now:

- resident `swarmforge-coder` hosts **documenter** (`➜ documenter ·
  git:(swarmforge-documenter)`), `Working… (2m 51s · ↑ 3.3k tokens)` on BL-1885 —
  the very ticket that parcel carries.
- coordinator `Working… (48s · ↑ 777 tokens)` on main.

So bedtime converges on its own: parcel forwards → `in_process` empties → drain
returns `drained` → `finish-shift`. **No deadlock, no stall, no nudge warranted** —
and nudging either seat would interrupt live work.

### The measurement correction this run nearly got wrong

> **`ls .swarmforge/handoffs/<role>/inbox/in_process/` is the WRONG path for a
> worktree role.** A glob over `.swarmforge/handoffs/*/` lists no `documenter`
> directory at all and finds **zero** `in_process` parcels anywhere under it — which
> reads as "the bedtime drain is blocked on a phantom that does not exist on disk",
> a false emergency I was one step from reporting to the human.
>
> The real mailbox is **`<worktree>/.swarmforge/handoffs/inbox/in_process/`** —
> here `.worktrees/documenter/.swarmforge/handoffs/inbox/in_process/`. Resolve it
> through `roles.tsv` column 3 via `mailboxBaseDir`/`mailboxDir`
> (`extension/out/swarm/swarmState.js`), which is what `buildRoleInboxes` and
> `isInFlightEmpty` actually use. Only `master`-resident roles (specifier,
> coordinator) live under the flat `.swarmforge/handoffs/<role>/` shape; this is the
> BL-1219 lesson (`buildRoleInboxes`' own comment warns of the "stale flat fossil
> directory") seen from the operator side.

## Swarm health at this run (green, freshly relaunched)

- **Seats:** 2 standing sessions UP, correct under mono-router — coder (resident,
  hosting documenter) and coordinator, both `uptime≈29s` at status time because of
  the 08:07:02Z relaunch, both actively Working, neither showing a modal or banner.
  6 seats DORMANT by design.
- **Daemons:** all 6 UP — handoffd pid 1845, supervisor 1875, operator-runtime 2936,
  babysitterd **pid 3953, watchdog `state: healthy` / `pidfile_alive: true` —
  TRUSTED, `start_babysitterd.sh` NOT run**, vscode-tunnel, bubble-cloudflared.
  `handoffd.heartbeat` 2026-10-10T08:07:02Z (fresh). Telegram bridge UP (3 procs).
  Provider available.
- **Git:** HEAD `d3429fb865` @ 06:15:17Z UTC (+01:00 converted per BL-482).
- **Backlog:** active=6 paused=167 **done=940** (up from 932 at 07:35Z — the
  ceremony's drain did land work). `failed/` empty.
- **Inboxes** (`*.handoff` only, sidecars excluded per the 07:35Z rule): coordinator
  `new=6`, specifier `new=1`, all others 0; one real `in_process` parcel, the
  documenter one above.
- **Asks:** `ask_escalation` ok. `role_questions.coder` still `escalated` (05-21
  vintage) — a role ask with no operator answer path.

## Disposition: note only

No nudge (both seats mid-work; the drain is converging), no notify (nothing the
human must decide — the relaunch was benign and bedtime is self-resolving), no ASK,
no commit, no code edit, and emphatically **no relaunch** — the pack was already
back up before this run began.

---

## CORRECTION — 2026-10-10T09:15Z (operator)

The conclusion above ("this subject will not re-fire") is **FALSIFIED**.
The escalation re-fired, and `is_qa_ancestor.sh 93a21154d6` now exits **1**
again: the QA branch take-up that made it exit 0 at 04:57Z has since been
undone, so the ancestry predicate flipped back. A take-up can rewind, so it
never closed anything — only a durable QA land-approval (BL-1405) does.
Ledger entry is still `state: stamp-open`, `stamp_ticket: BL-2120`,
`human_decision: null`; BL-2120 is still in `backlog/paused/`.
Live handling: `.swarmforge/operator/NOTE-article42-refire-0915.md`,
pointer note queued to the coordinator at 09:17Z.

---

## 10th operator escalation (2026-10-10T09:41:12Z) — premise unchanged, no new action

Verified live at 09:45Z, not recalled:

- `is_qa_ancestor.sh 93a21154d6` exits **1** (still genuinely unreviewed).
- Ledger line 1710: `state: stamp-open`, `stamp_ticket: BL-2120`,
  `human_decision: null`. `BL-2120-stamp-off-...yaml` still in `backlog/paused/`.
- The 09:15Z note to the coordinator (parcel `017825`) is **still queued** in
  `inbox/new`, behind 5 older parcels, with a fresh `.chase.json` (09:39Z).
  The coordinator is genuinely mid-turn (pane "Working… 1m 33s", ctx 44.3%) and
  is draining parcel `017817` (claim-progress stamped 09:41Z). Nothing wedged,
  so **no second note was sent** — that would be blind re-nudging.

### Correction to the 08:14Z root cause (narrower than the truth)

08:14Z recorded "babysitterd escalates to the operator only when it cannot
nudge the coordinator (`NUDGE-SKIP no tmux socket`), so the subject arrives
whenever the pack is down at sweep time." The pack is **UP** now and it still
escalated. The real switch is **any** NUDGE-SKIP reason; since 09:10:39Z every
sweep logs `NUDGE-SKIP coordinator busy — pane mid-turn (esc to interrupt) —
retry when idle`. A healthy, continuously-busy coordinator therefore produces
operator escalations indefinitely. CRIT fires every ~5 min; the operator
escalation is deduped to roughly every ~30 min (10 deliveries, 04:31Z→09:41Z).

### The designed route is demonstrably working — and it is NOT a branch take-up

At 09:42:15Z the coordinator landed `f06e1f76e4` "BL-2111: move stamp-off to
done (QA-approved, `is_qa_ancestor 009daacae7` exits 0)". That exit 0 is
**genuine**, not the 04:57Z branch-take-up artifact: `refs/heads/swarmforge-QA`
tip is `c6ecbacb12` "BL-2111: stamp-off review of hotfix 009daacae7", author
**and** committer date 2026-10-10T02:34:07Z — a real QA review commit.

That same tip is why `93a21154d6` (authored 04:28:35Z) is **not** an ancestor:
QA's reviewed tip legitimately stops short of it. So the two commits diverging
(`009daacae7` exit 0, `93a21154d6` exit 1) is the *correct* reading, and proves
this is not another blanket take-up. BL-2120 now has a fresh, working precedent
one hour old: a QA stamp-off review commit on `swarmforge-QA` closes it and
stops the re-firing. Promote/dispatch of BL-2120 remains the coordinator's call.

## 11th delivery (10:11:58Z) — the subject is now a SYMPTOM, not the fault

Adjudicated 2026-10-10T10:19Z. Premise re-verified live, not recalled:
`is_qa_ancestor.sh 93a21154d6` exits **1**, `backlog/hotfix-ledger.yaml:1710`
has `state: stamp-open` / `human_decision: null`, and
`backlog/paused/BL-2120-stamp-off-hotfix-93a21154d6-miniapp-pane-history.yaml`
is still parked. So the Article 4.2 finding itself is unchanged and still
GENUINE. What changed is the *reason* it re-fired.

### The nudge LANDED this time — the previous root cause is now too narrow

My 09:47Z pass concluded the switch was "ANY NUDGE-SKIP reason", since every
sweep from 09:10:39Z logged `NUDGE-SKIP coordinator busy`. That is no longer
the whole story. The babysitterd log shows:

- `10:01:48Z CRIT [pipeline-code-on-main-93a21154d6…]` + **`NUDGED coordinator:
  1 finding(s)`** — a real delivery, NOT a skip. The pane was idle enough.
- `10:06:54Z CRIT` — no nudge, no skip line.
- `10:11:58Z CRIT` + `ESCALATED operator: …`.

So the third escalation switch is: **a nudge that is DELIVERED but whose
handling never completes.** The coordinator took the finding up and wedged
mid-handling. A delivered nudge is therefore not evidence the subject is
being handled — only a state change (QA review commit / ledger decision) is.

### The actual fault: a loop-detector MODAL that did NOT self-clear

`swarmforge-coordinator:0` is frozen on the TUI dialog "A potential loop was
detected" (options `1. Keep loop detection enabled (esc)` /
`2. Disable loop detection for this session`), sitting above visible
scrollback of 4+ repetitive `git stash drop` calls
("Drop worktree-drift for swarmforge-coder") — the repetition that tripped it.

Continuously present ≥10:13:30Z → 10:19:04Z (**~6 min**), verified by a
200s uninterrupted poll (10:14:37Z→10:17:57Z, `MODAL-STILL-PRESENT`) plus
live `capture-pane` before and after. It is LIVE, not scrollback: the box art
occupies the bottom of the visible screen and covers the footer.

**This falsifies the standing modal rule.** All five of today's earlier wedges
decayed modal→banner inside ~100s–4min (precedent: 06:06Z modal → 06:10Z
banner), which is why the recorded guidance was "recapture 2–3min instead of
paging the human for a keystroke". This one is outside that window and is not
self-resolving, so recapturing is no longer the answer.

### Disposition: ONE notify, no keystroke

Dispatch is frozen — `main` HEAD is still `8b1144744c` @09:46:46Z (**32 min**
stale). Notably the coordinator inbox `inbox/new` holds **0** live `*.handoff`
parcels (only one `.dead`), so nothing is queued behind the wedge and my 09:15Z
BL-2108 note was drained. BL-2111 and BL-2115 were both closed by the designed
stamp-off route at 09:42–09:46Z; BL-2120 is simply next in that same queue and
only the wedge is in the way.

Why no keystroke: inject during the MODAL phase types into the dialog, and
option 2 is a config change that is not the operator's to choose. Option 1 /
esc changes no setting, but pressing keys in an agent pane stays the human's
call — the recorded rule for a genuinely frozen dialog is ONE notify, never
the keystroke and never an ASK that duplicates it. Notify sent to SUP-2 at
10:19Z (`{"notice":"notify"}` confirmed). No ASK (would duplicate the notify).

Everything else GREEN: both mono-router sessions UP (born 09:10:22Z),
handoffd heartbeat 10:13:36Z fresh, babysitterd pid 11567 up 1h04m sweeping,
pipeline board `lastChangeMs` 10:14:39Z (no freeze), backlog active=5
paused=166 done=932, no ceremony, no control-pause.

---

## 12th operator delivery — 2026-10-10T10:42Z..10:47Z (operator run)

**Verdict: the subject is again a SYMPTOM. The real fault was the SEQUEL to
the 11th delivery's non-decaying modal, and it is now CLEARED by one nudge.**

### Premise re-verified live, not recalled

- `swarmforge/scripts/is_qa_ancestor.sh 93a21154d688e9f2ca15a426ce2afecb4f118456` -> **exit 1**
- `swarmforge/scripts/is_qa_ancestor.sh b24cc182e5` -> **exit 1**
- `refs/heads/swarmforge-QA` still `c6ecbacb12bc94205894aa0e22ee5a9af5e2cfdb` @ 02:34:07Z (discarded take-up has NOT returned)
- `backlog/hotfix-ledger.yaml`: `93a21154d6` -> `state: stamp-open`, `stamp_ticket: BL-2120`, `human_decision: null`; `b24cc182e5` -> `state: stamp-open`, `stamp_ticket: BL-2121`, `human_decision: null`
- `backlog/paused/BL-2120-stamp-off-...yaml` and `backlog/paused/BL-2121-stamp-off-...yaml` both `status: todo`

Close-out therefore still **UNRECORDED**. QA-ancestor route unavailable
(exit 1 both), so only the stamp-off promote route or a `--record` waive
closes it; the waive is still ignored by the escalation channel until BL-1404.

### What the 11th delivery's modal turned into

The 10:19Z notify (SUP-2) was acted on: the loop-detector modal was answered
with **option 2**, and the pane now reads

    Loop detection has been disabled for this session. Please try your request again.

Not answered by me — I took no keystroke, by rule. Two consequences, and the
first is the fault:

1. **Option 2 ABORTS the in-flight turn.** It does not resume it. The
   coordinator was left idle at an empty input box, last pane activity
   ~10:32Z (~13m), with `coordinator/inbox/new/` holding **0 live
   `*.handoff`** (one `.dead` only) — it had already drained my 09:15Z note.
   So **nothing in the system would ever re-wake it**: no inbox parcel to
   chase, no chaseCount to climb, no daemon retry. Dispatch was frozen with
   every signal green.
2. **Loop detection is now OFF for the rest of this coordinator session.** A
   repeat of the same runaway will not be caught a second time.

Freeze tell, again, was HEAD-only (confirming the 11th delivery's new rule):
`main` HEAD unchanged at `8b1144744c` @09:46:46Z for ~58m while both sessions
were UP and every daemon green.

### The loop source, and the hazard in resuming it

Visible scrollback: `git stash drop stash@{0}` issued one-at-a-time,
captioned "Drop worktree-drift for swarmforge-coder", 5+ repetitions.
`git stash list` still holds **127 entries**, and they are NOT all
worktree-drift — `stash@{1}`, `{2}`, `{5}`, `{7}`, `{9}` are
`... WIP preserved before pull` / `BL-xxxx WIP` entries. A pulled parcel's
commits survive only under `refs/swarmforge/parcel-backup/<role>/<ts>`, so a
blind positional `stash@{0}` drain destroys the only copy of that work as the
worktree-drift entries above them are removed. Recorded as a hazard to the
coordinator; the call stays the coordinator's.

### Action taken (exactly one)

ONE targeted nudge to the correct actor. The modal was gone (live
`capture-pane` with no `-S`: footer band intact, empty input box, no spinner,
`pane_dead=0`), so sync inject was permitted again — the forbidden->permitted
flip of the modal/banner rule.

- Wrote `.swarmforge/operator/NOTE-art42-1045.md` (operator-owned state) with
  the Article 4.2 table, the exit-1 proofs, the BL-2111/BL-2115 precedent,
  and the stash hazard.
- Injected the ≤80-char pointer (`inject_note_to_role.sh` hard-caps the
  message at 80 chars and rejects sender role `operator`; default
  `coordinator` sender is the established path for operator notes).
- Confirmed: parcel `50_20261010T104602Z_017828`, traffic log
  `10:46:03.178Z source=sync-deliver outcome=ok role=coordinator attempts=1`,
  and the pane flipped idle -> `Working... (4s)` on
  "You have new handoff mail." **Dispatch unfrozen.**

### Rest of the sweep: GREEN

- mono-router shape correct: 2 standing sessions (coder resident +
  coordinator), both `pane_dead=0` — normal topology, not pane loss
- coder live and healthy on BL-2116, `Working... (26m 54s)`, ctx 57.3%
- handoffd heartbeat 10:42:24Z fresh; babysitterd pid 11567, `pidfile_alive`,
  `state: healthy`, single instance; `provider_state: available`
- pipeline board NOT frozen: `pipelineBoard.lastChangeMs` 10:45:45Z is NEWER
  than the newest `backlog/{active,paused}` mtime (06:15:11Z) — no mismatch
- backlog active=5 paused=166; no `closing-ceremony-state.json`, no control-pause
- open side-note, unchanged and not mine to resolve: `role_questions.coder`
  still `state: escalated` since 2026-10-09 (no operator answer path exists)

### Not done, deliberately

No keystroke in any pane, no second notify (the nudge is the lever and it
took; escalate next run only if it does not hold), no ASK (would duplicate
the 10:19Z notify), no respawn, no `ensure`, no relaunch, no
waive/promote/approve/close, no backlog-state edit, no commit to `main`, no
code edit, no `status.json` write (runtime owns every field; nothing material
of mine moved).

---

## CORRECTION appended by the operator at 2026-10-10T11:47Z

**The prediction above ("this subject will not re-fire") was WRONG.** The
subject has now been delivered **88 times** (last CRIT 11:43:35Z, cadence
~5min) and escalated to the operator again.

Why: **the QA-ancestor pass was TRANSIENT, not a close-out.** At 05:04Z
`refs/heads/swarmforge-QA` had been taken up onto current `main`
(`ceb99d05ce`), which made every hotfix on `main` an ancestor and flipped
`is_qa_ancestor.sh` to exit 0. That take-up did not survive: the QA branch is
back at `c6ecbacb12` (committer date 2026-10-10T02:34:07Z), so
`is_qa_ancestor.sh 93a21154d688e9f2ca15a426ce2afecb4f118456` exits **1**
again, verified this run.

Lesson for the next reader: a bare `is_qa_ancestor.sh` exit 0 with no
`approved:` line is **not** a recorded close-out and must never be used to
predict that an Article 4.2 subject will stop firing. Only a recorded
close-out does that — and until BL-1404 lands, only the stamp-off/QA-approval
route actually silences the channel (a `babysitter_waive.bb --record` waive is
a valid close-out but is still ignored by the escalation channel).

## Current disposition: remedy IN FLIGHT, no operator action

The designed path is moving and needs nothing from me:

- `backlog/hotfix-ledger.yaml` entry: `state: stamp-open`,
  `stamp_ticket: BL-2120`, `human_decision: null`.
- The operator surfaced the two routes to the coordinator in
  `.swarmforge/operator/NOTE-art42-1045.md` (delivered 10:45Z). **That nudge
  took** — the coordinator chose the stamp-off route and promoted it:
  `316f0ea2af` (promote BL-2120/BL-2121) + `018e3a0f48` (remove the stale
  paused copies), then `git_handoff` BL-2120 → coder at ~11:19Z.
- `backlog/active/BL-2120-stamp-off-hotfix-93a21154d6-miniapp-pane-history.yaml`
  is now the single tracked copy, `status: todo`.
- Coder is UP and mid-turn (on BL-2116) with 14 parcels queued in its
  worktree inbox; BL-2120 drains behind them.

Re-fires every ~5min are EXPECTED until that stamp-off lands, exactly as
BL-2111/BL-2115 re-fired until they closed at 09:42–09:46Z. A third operator
note on this subject would be noise — the second one already took.
