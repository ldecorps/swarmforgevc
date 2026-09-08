# Intake: a question the Operator could not answer

Filed by the Operator (2026-09-08T02:33:30.204260433Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

DEFECT (operator-filed, recurring, un-ticketed): the handoffd supervisor's "alarm-and-halt stalled" path silently kills the ENTIRE swarm, and BL-977 did not fix it.

WHAT HAPPENS: when the supervisor decides the daemon is stalled it fires "alarm-and-halt stalled" and stops. That halt takes down all 9 role panes AND the tmux server with them. It writes NO row to kill-all-audit.log (last audit row is 2026-09-07T06:12:36Z), sets no control-pause, and logs no availability "stop" row - so `./swarm status`, the audit trail and the availability telemetry all show a clean swarm while every agent is dead mid-work.

FREQUENCY (measured in .swarmforge/daemon/handoffd-supervisor.log): 71 "alarm-and-halt stalled" events since the log begins 2026-08-27T16:35:34Z. TWO of them today caused full swarm deaths - 2026-09-08T01:47:12.856Z (supervisor stopped 01:47:26Z) and 2026-09-08T02:30:29.238Z (supervisor stopped 02:30:42Z). Both were confirmed real total deaths by the four-signal test: tmux server gone, no kill-all-audit row, control-pause.json active=false, supervisor log showing the halt.

WHY IT LOOKS BENIGN AND IS NOT: babysitterd auto-repairs each time (01:50:02Z / 02:32:01Z supervisor restart, roles back ~90s-3.5min later), so from outside it reads as a transient blip. But every role loses its entire in-flight context, and any parcel mid-handoff at that instant is at risk.

WHY THIS IS A REGRESSION, NOT A NEW BUG: BL-977 "supervisor never halts a progressing daemon" was closed on 2026-08-20 (commit 71ee848286). Its own topic record states the exact failure this is: "handoffd supervisor halted a PROGRESSING daemon: heartbeat-file mtime (61803 ms) crossed the 30s stall window during a 143s in-flight sweep". That is precisely what is still happening - long in-flight sweeps (test:properties is known to run ~143s) push the heartbeat-file mtime past the stall window and the supervisor halts a daemon that is making progress. So either the BL-977 fix does not cover the live path, or it regressed.

TWO SEPARABLE DEFECTS FOR TRIAGE:
(1) the false stall verdict itself (a progressing daemon judged stalled), and
(2) the blast radius + silence: a supervisor halt should never take the tmux server and 9 agents with it, and if it does it MUST write a kill-all-audit row and an availability stop row so the death is visible rather than inferred from a log grep.

The operator has flagged this to the human twice on SUP-17 (2026-09-08 01:56Z) with no answer, and no active or paused ticket covers it (BL-977 is in backlog/done/; BL-326 only references alarm-and-halt as a test fixture; BL-1454 is the separate GH-24 kill loop). Filing as raw intake for the specifier to triage and mint - the operator does not spec or promote.
