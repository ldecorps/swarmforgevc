# Disposition (specifier, 2026-09-19)

Drained from the backlog root on 2026-09-19. Every "Wanted" sentence below
survives verbatim in the `source:` of the ticket that carries it
(Article 5.3). The 1:N split:

- **Item 2 (babysitterd survives bedtime) → BL-1639** (`backlog/paused/`,
  defect, high, auto-approved). Root cause re-read from the code, not the
  pid list: the `SIGTERM agents:` list is the agent sessions; babysitterd
  is stopped one line earlier by `stop_babysitterd`, which signals the
  tracked pidfile `.swarmforge/babysitterd/babysitterd.pid` only, while the
  verify matches any `babysitterd.sh` process. The survivor (31823) was a
  SECOND daemon: `.swarmforge/operator/day-shift-start.sh` launches the
  older operator-local copy `.swarmforge/operator/babysitterd.sh` (pidfile
  `.swarmforge/operator/babysitterd.pid`) two seconds after `start-swarm.sh`
  already started the tracked one (29714) - the launcher's "start-swarm.sh
  does NOT start babysitterd" comment is stale. Same pair on 07-30, 08-21,
  09-01, 09-04, 09-10, 09-18, and again at the 01:00 night-start today
  (pids 10398 tracked, 12580 operator). BL-1639 makes stop, verify and
  `kill_all_swarm.sh` read one root-scoped census. The launcher itself is
  gitignored: a human hotfix, not a ticket.
- **Item 1(b), the safety margin → BL-1640** (`backlog/paused/`, defect,
  high, PENDING a ruling A/B). What actually happened at 16:00:01Z: the
  sleep-path ceremony took ONE tick (`sequence: ["freeze-promotion"]`,
  `hardDeadlineMs` = 07:45Z that morning, computed from
  `closure_stop_local`) and the stack was killed four seconds later. The
  margin BL-658 designed (drain + briefing budgets ahead of the stop) never
  applies on a sleep. Same on 09-17 (`advanced: false`: the morning window
  had consumed the day's night key).
- **Item 1(b), the forcing → BL-1641** (`backlog/paused/`, defect, high,
  PENDING a ruling A/B). The 09-18 briefing was NOT unwritten: the
  documenter committed it on its branch at 15:47:36Z (`1af06d965b`) and
  sent QA the landing note at 15:46:15Z; QA never reached it before the
  kill. At the deadline the ceremony lands the documenter's own commit when
  one exists, else composes the banked briefing (BL-308), and stays loud.
- **Item 1(a), the injected nudge → no new ticket; BL-1458 amended.** The
  daemon logs show no `briefing-generation-nudge-sent` on 2026-09-18 and
  `.swarmforge/daemon/inject-traffic.log` has no briefing injection that
  day. The `briefingInstructed`/`briefing-missing` flags read as
  "every tick" are the previous night's `done` ceremony state re-logged by
  `closing-ceremony-run` each sweep. The BL-258 fallback is dormant on the
  closure-scheduled path, as BL-1458 (paused, approved 09-07) says; BL-1458
  retargets it to a documenter mailbox note and was amended today with a
  once-per-day guard (scenario 06) and re-pended for that change. What woke
  the coordinator at 15:35 is not in any mailbox; it relayed on its own.

Observations recorded, not ticketed this pass:
- The ceremony's `briefingAlreadySent` reads `.sent.json` (the email), not
  the file on main: on 09-16 and 09-17 the briefing landed at 07:13Z and
  `closing-briefing-missing` still fired at 07:45Z because the email went
  out at 09:07Z. A "composed but unsent" state deserves its own surface.
- `docs/briefings/.sent.json` is modified and uncommitted on main since
  2026-09-17 09:07Z (the 09-17 send's marker commit did not land; that was
  the day every direct-to-main commit was refused by the handler guard).
- The BL-1393 e2e proves "finish-shift drives the sequence" by grepping
  `finish_shift_lib.sh` for the CLI call (BL-1235 shape); BL-1640's
  Background builds the in-flight sleep it never constructed.

---

# Intake: today's daily briefing never went out — cron PATH bug (fixed), and two open gaps in the bedtime chain

Filed by the human via Claude Code (2026-09-18T18:00Z, approx). RAW ask, not
a spec: the specifier drains this like any other backlog-root item and
decides what (if anything) becomes real tickets.

## What happened

`docs/briefings/2026-09-18.md` was never generated/sent tonight. Investigated
end-to-end from `.swarmforge/operator/day-shift.log`,
`.swarmforge/daemon/handoffd.log` and the documenter's completed mailbox.

## Already fixed (operator hotfix, no ticket needed for this part)

Cron runs jobs with a bare minimal `PATH` (no `~/.local/bin`), so `bb`,
`claude` and `tmux` — all installed under `~/.local/bin` — are not found by
scripts invoked from crontab, even though they resolve fine in an
interactive shell. This morning (08:00:13Z) `day-shift-start.sh`'s
`rotate_to_role.sh` failed `exec: bb: not found` (rc=127) and the
launch briefly read `DEGRADED windows=0` before the swarm evidently
self-healed (the rest of the day shows normal, busy activity —
`inject-traffic.log`, `handoffd.log`'s sweep cadence, etc.). `start-swarm.sh`
already exports a full PATH at its own top for exactly this reason; the
bedtime/rotation scripts never got the same treatment.

Fixed by exporting the same PATH start-swarm.sh uses, at the top of every
cron-invoked entrypoint in the chain: `finish-shift` and
`swarmforge/scripts/wait_for_expedite_then_bedtime.sh` (tracked, committed
`daa34e6778`, `Hotfix-Certification: pending`, ledgered); plus the untracked
local copies of `day-shift-start.sh`, `day-shift-bedtime.sh` and
`night-start.sh` under `.swarmforge/operator/` (gitignored, fixed in place,
no commit needed/possible for those three).

## Two things NOT fixed — genuine root causes of tonight's gap, need a real ticket

1. **The actual reason the briefing never got written.**
   `briefing_generation_schedule_lib.bb`'s sweep correctly detected the
   missing file from early morning and, every `briefing-generation-sweep`
   tick, **tmux-injects** the "Daily briefing due" instruction straight into
   the coordinator's live pane (`handoffd.bb`'s `briefing-generation-sweep!`,
   `:notify!` → `agent-runtime-inject/notify-agent!`) — a fire-and-forget
   nudge into a busy pane, not a tracked/escalating request. The coordinator
   had a very active day (branch-behind merge-up notes, ticket
   promotion/routing, QA/hardender traffic) and did not relay it to the
   documenter (`produce the morning briefing for 2026-09-18`, note
   `00_20260918T153550Z_009559`) until **15:35:50Z** — only ~25 minutes
   before the 16:00Z (17:00 BST) bedtime SIGTERM'd every agent. The
   documenter's mailbox shows the note reached `completed/`, but the file
   was never written/committed — no runway.

   Wanted: some combination of (a) escalating the injected nudge if
   unaddressed past N sweep ticks — surface it as a real handoff note to the
   coordinator, not just a repeated tmux inject, so it survives a busy pane
   and shows up in mailbox-based dropped-parcel sweeps; (b) reserving a
   safety margin before a scheduled bedtime so a due-but-unwritten briefing
   gets escalated/forced (e.g., the existing headless `compose-headless!`
   path, currently only used when `hibernated?`, triggered instead once
   bedtime is imminent and the file still doesn't exist) rather than being
   silently swallowed by the shutdown.

2. **`kill_all_swarm`'s SIGTERM list missed a live process.** Tonight's
   bedtime (16:00:05Z) logged `REFUSE: finish-shift left the stack in an
   unexpected state: still running (should be stopped): babysitterd` — the
   SIGTERM pid list it printed (`649 937 982 1147 14367 26097 28509 30498
   31923 32278`) did not include babysitterd's actual running pid (31823,
   started 08:00:15Z by `day-shift-start.sh`). `finish-shift` reported rc=1;
   the process sat orphaned until the operator killed it by hand tonight.
   Wanted: whatever builds that pid list should read it from the same
   source `day-shift-start.sh`/`night-start.sh` write
   (`.swarmforge/operator/babysitterd.pid`) rather than a possibly-stale
   enumeration, so a bedtime that starts right after a fresh babysitterd
   launch doesn't miss it.

## Pointers

- `.swarmforge/operator/day-shift.log` (today's run, `=== begin ===` at
  `2026-09-18T08:00:01Z` through the bedtime REFUSE at `16:00:08Z`).
- `.swarmforge/daemon/handoffd.log` (rotated hourly-ish;
  `briefing-generation-sweep` entries, `briefingInstructed`/`briefing-missing`
  flags).
- `swarmforge/scripts/briefing_generation_schedule_lib.bb`
  (`generate-briefing-if-due!`, the `hibernated?` headless-compose branch).
- `swarmforge/scripts/handoffd.bb` `briefing-generation-sweep!` (~line 5030).
- `swarmforge/scripts/finish_shift_lib.sh` / `kill_pipeline_swarm.sh` for the
  SIGTERM pid enumeration.
- Hotfix commit: `daa34e6778`. Ledger entry: `backlog/hotfix-ledger.yaml`.
