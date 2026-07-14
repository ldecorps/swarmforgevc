# Postmortem: the day the swarm "died" — 2026-07-13

**Author:** the external Claude Code recovery session, at the human's request,
while the host was down (evening of 2026-07-13). Compiled from git history,
the day's ops-diag snapshots (pushed to the `ops-diag` branch by the human),
and the operator's own logs as captured in those snapshots. All times BST
(host clock) unless noted.

**Headline:** the swarm never died. Five separate observability/liveness
defects stacked so that a working system was indistinguishable from a dead
one — and the human spent a day resuscitating things that were mostly alive.
Every one of the five is now fixed, active, or ticketed.

## Timeline

| Time | Event | Evidence |
|---|---|---|
| Jul 12 19:46 | Operator parks lean-drain crew: claude weekly limit at 99% (resets Jul 16). | operator.log |
| Jul 13 01:17 | Operator finds bot+bridge running a 24.9h-stale build (BL-298/320/325 inert), recompiles and restarts both; files merged-code-never-reaches-daemons intake (-> BL-328). | operator.log |
| 03:38–04:01 | Swarm lands + closes BL-328 (build freshness). Backlog drained; holds per BL-318 rather than self-generating. **6 commits stay unpushed** — from outside, the swarm "dies" at 04:01. | 216c86f, 8454011 |
| 04:02–06:48 | Swarm/operator keep working (BL-324 approval fix, BL-329/330 promotions, human approvals recorded, 7 intakes filed, epic topics, icon convention). None of it visible on origin. | operator.log, db2e02f..ddfb9d0 |
| ~06:26 | Operator's own diagnosis, in its log: "front desk starved 2 days (interactive Operator blocks event queue)". It then continues the interactive icon conversation anyway. | operator.log |
| ~07:45 | The interactive Operator wedges: a relayed human message sits **typed but unsubmitted** in its input buffer ("can you also add an icon to the general topic?"); the process never returns to consuming events. `llm_running: true` blocks all further launches. | ops-diag pane captures (identical at 09:16 and 10:13 snapshots) |
| 08:25 | Runtime starvation alarm fires: `pending= 27`. The alarm goes nowhere a human can see (no headless sender — the BL-333/345/349 family). | runtime.log |
| 08:36–09:54 | Human asks in Telegram **General** three times; silence. Cause was later found in `telegramFrontDeskBotCore.ts` (BL-294): General messages have no `message_thread_id`, fold into the default SUP subject, and replies route to the SUP topic — never back to General. | -> BL-355 (active) |
| 08:44–09:00 | Human (via external session) merges approvals for BL-329..332 (PR #4) and manually reconciles the diverged histories (the 6 unpushed commits). | e5a0c09, 037c9fc, 61ea47a |
| 09:18 | `swarm_ensure`: extension, all 8 agent panes, daemon — every component HEALTHY. Confirmed: the swarm was never down. | user terminal capture |
| ~09:18 | A tmux Enter keystroke into the wedged operator is a no-op (process hung/dead at TUI level, "1% until auto-compact"). The operator session is killed manually: `tmux kill-session -t operator`. | ops-diag 3 |
| 09:19–10:07 | Runtime reaps the dead run, then drains the entire 28-event backlog in six batches. `front-desk-replied SUP-2` at 10:09. The restricted front-desk operator (BL-334, shipped this same morning) is observed live on its own socket. | events-done/ listing, runtime.log |
| 11:48 | Front-desk reply-relay degrades again ("5 consecutive reconnect failures ... terminated"); supervisor auto-restarts bridge+bot. Chronic across every generation this day; intake filed Jul 12 evening. | front-desk-supervisor.log |
| 11:51–15:11 | **Second push gap (3h20m).** Swarm ships BL-335/336/343, specs+promotes BL-346/349–353 — all invisible on origin until the human pushes by hand. | -> BL-356 (active) |
| 13:05–13:11 | Human's "please drain the root intake" (General) is processed within 4 minutes; reply routed to the SUP topic per the BL-294 mechanism; human sees silence in General. | runtime.log 12:09Z launch |
| 15:11–17:16 | Histories reconciled; intakes drained to **BL-355/BL-356** and promoted; swarm closes BL-338, BL-346 (standing Operator topic), BL-350, BL-352, BL-353, BL-358 (untagged gates route to the new Operator topic). | fe47e10..76e61dc |
| ~17:16+ | **Host goes down** (WSL/Windows). Tunnel unreachable by ~18:52. Nothing on the box is boot-persistent — live demonstration of BL-351, ticketed hours earlier. | tunnel "Opening Remote…" hang; no pushes after 17:16 |

## The five stacked defects

1. **A single interactive Operator blocks the event queue** (root cause of the
   starvation). Fixed structurally the same day: BL-333 (alarm observable),
   BL-334 (restricted front-desk operator, shipped), BL-345 (alarm delivery,
   active), BL-359 (always-on presence, paused — the human's "attended mode
   won't stay up" is this ticket).
2. **Alarms with no headless sender.** The starvation alarm fired at 08:25
   into a log nobody reads; same shape as BL-349 (stuck-role escalation) and
   the BL-214/BL-335 family. BL-345/BL-349 active/expedited.
3. **Replies route away from the asking thread** (BL-294 default-subject
   folding). The human asked five times in General over one day and every
   answer went to a SUP topic. BL-355 active.
4. **`main` not pushed** — twice in one day (6 commits overnight; 3h20m in the
   afternoon). A working swarm reads as dead to every outside observer, and
   outside work (GitHub-side approvals) forces divergence. BL-356 active.
5. **Nothing survives a reboot** (BL-351, active/expedited): no systemd units;
   bridge, bot, tunnel, runtime, daemons all hand-launched. The host going
   down this evening took every recovery channel with it, including the
   tunnel this incident was debugged through. The Windows half (starting the
   WSL VM itself) is outside the swarm's reach — see
   `swarmforge/deploy/windows/` added alongside this postmortem.

## Also observed, not yet ticketed

- **Parked-vs-dead ambiguity:** BL-324's scale-to-zero parking kills panes on
  every promote. To the human, a parked role and a crashed role look
  identical ("swarm agents falling like flies"). A parked role should be
  visibly parked (tile state, roster annotation), not apparently dead.
- **Reply-relay chronic reconnect death:** degraded-then-terminated in every
  front-desk generation observed today (01:27, 06:37, 11:48). An intake was
  filed Jul 12 per operator.log; verify it became a ticket and did not get
  lost in the same starvation it coincided with.
- **The wedged-operator failure mode itself:** a relayed message whose Enter
  never lands leaves the operator waiting at a prompt forever while
  `llm_running: true` suppresses all recovery. The runtime should detect
  "operator alive but queue not consuming for N minutes" and recycle —
  BL-345's alarm makes it visible; nothing yet makes it self-heal.

## What the human should do on next boot

1. `wsl` → `cd ~/swarmforgevc && ./swarmforge/scripts/swarm_ensure.bb "$PWD" && ./swarmforge/scripts/start_operator_runtime.sh "$PWD"`
2. Expedite BL-351; run `swarmforge/deploy/windows/` installer for the
   Windows half; disable host sleep.
3. Approve/promote BL-359 (always-on operator presence) and consider an
   intake for parked-vs-dead visibility.
