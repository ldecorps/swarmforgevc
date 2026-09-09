# handoffd supervisor `alarm-and-halt stalled` kills the ENTIRE swarm — 4x in 8h (2026-09-08)

Operator run 2026-09-08T01:50Z, event `SWARM_CONTROL_LOST`.
All timestamps UTC (BL-482; host is UTC+1).

## Verdict

REAL total swarm death at 01:47:12Z — **not** a planned ceremony sleep, **not** a
false SWARM_CONTROL_LOST. Fully self-recovered by babysitterd at 01:51:38Z.
NO operator relaunch was performed or needed.

## Why it is NOT the known false positives

- `kill-all-audit.log` last entry is **2026-09-07T06:12:35Z** — no kill_all today.
  The halt path does NOT write that audit log, which is why the usual
  "check kill-all-audit first" probe reads clean on a real death.
- `control-pause.json` absent.
- `closing-ceremony-state.json` is **yesterday's**: `nightKey 2026-09-07`,
  `phase done`, hardDeadline 2026-09-07T05:00:00Z. Its `swarm-stopped` /
  `rotationRequested` surfaces are STALE state echoed into the failure report —
  they do not describe a ceremony running now.
- availability jsonl has no `stop` row today after the 00:00:02Z start.

## Causal chain (established)

1. 01:46:33Z — last handoffd output: `sweep-boundary sweep=main-sync-deadlock-sweep ms=1153`.
2. 01:46:33Z→01:47:12Z — 39s with no handoffd progress, crossing `SUPERVISOR_STALL_MS` (default 30000).
3. 01:47:12.856Z — `handoffd-supervisor.log`: `alarm-and-halt stalled`.
   `handoffd_supervisor.bb:552-556` runs `swarm-cleanup.sh <socket> <window-ids> <sessions>`,
   which tears down every role session AND the tmux server.
   `swarm_ensure.bb:102` states it outright: "a :dead/:stalled verdict it calls
   alarm-and-halt!, which kills every agent". BL-144 posture = human-recovery-only.
4. 01:47:26Z — `supervisor stopped`. All 9 agents dead mid-parcel.
   Inboxes at death: coder 1, hardender 3, documenter 1, QA 1, coordinator outbox 1.
5. 01:50:01Z — handoffd restarted (`daemon-start-audit.log`, caller=unknown).
6. 01:51:38Z — babysitterd found 9 missing sessions, raised 10 escalations,
   `NUDGED coordinator: 10 finding(s)`, and respawned all 9 roles.
7. 01:52:12Z — 9/9 panes `dead=0`, 9 claude procs etime ~31s, coordinator actively
   working (spinner "Warping… 29s"). Recovered.

## The real finding: this is a long-running crash loop, silently masked

**Authoritative count = one `handoffd-failure-*.log` report per halt** (the
supervisor log undercounts: it has a NUL/binary-corruption history — note the
`.log.binary-*` / `.log.nul-scrub-*` siblings — and greps over it truncate).

`ls .swarmforge/daemon/handoffd-failure-*.log` → **147 halts since 2026-07-15**:

```
20260715  1     20260726  7     20260827  2     20260902  6
20260718  3     20260727  6     20260828  6     20260906 12
20260719 10     20260728  2     20260829 14     20260907 26
20260721  1     20260821  8     20260830  9     20260908  1
20260722 20     20260823  1     20260831 10
20260726  7     20260826  1     20260901  1
```

**26 halts on 2026-09-07 alone**; today's 01:47:12Z is 09-08's first.
Recent full-swarm kills: 09-07 18:03:30Z, 19:44:01Z, 23:02:51Z, 09-08 01:47:12Z —
4 in ~8h, on top of a 16-halt burst every ~6 min on 09-07 04:16Z-06:04Z.
All reports read `reason: stalled`, `restart_history: nil`, `last_incident: nil`.

Each halt destroys nine agents' in-context work mid-parcel. babysitterd repairs it
~4 min later, so the swarm always LOOKS healthy by the time anyone reads it — the
2026-09-07T23:12Z operator run saw exactly this and correctly logged "ALL STALE,
babysitterd already repaired". Across 147 events the pattern is unambiguous.

Note the design tension: BL-144 deliberately makes the halt human-recovery-only,
but babysitterd auto-repairs it unattended, so the intended human gate never fires.

## Known-adjacent prior art

`daemon_cycle_guard_lib.bb:56` documents the SAME failure mode:
"the supervisor could not see that a 143s dropped-parcel-sweep was legitimately in
flight, so heartbeat-file mtime alone crossed the 30s window and alarm-and-halt!
killed a progressing daemon" (2026-08-20T07:55:35Z). BL-977 added the on-disk
in-flight sweep marker (`.swarmforge/daemon/handoffd.sweep-marker`) to fix that.
Whether these four halts are the same false positive leaking past the marker, or a
genuinely wedged daemon, is NOT established here and is the open question.

No existing active/paused ticket covers this
(`grep -rln "alarm-and-halt|supervisor.*stall|halt-swarm" backlog/active backlog/paused`
→ only BL-1285, unrelated front-desk fixture races).

## Operator action taken

Diagnosis + this evidence file + ONE notify to the human on SUP-17. No relaunch,
no respawn, no config/code change, no ticket minted (specifier's call), no nudge —
the swarm was already healthy and working when the sweep completed.
