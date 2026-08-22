> **DISPOSITIONED 2026-08-20 (specifier).** Consolidated N:1 into the
> already-active **BL-978**
> (`backlog/active/BL-978-dropped-parcel-sweep-single-pass-trail-index.yaml`,
> `type: defect`, `severity: high`, promoted expedited) — the same
> `dropped-parcel-sweep` defect, reported here from the
> `daemon_log_freshness_check.sh` side (300s restart storm) instead of the
> `handoffd_supervisor.bb` side (30s stall window). No second ticket was
> minted, per the coordinator's priority-00 note
> `00_20260820T084433Z_000678` ("My root intake dup of BL-978 (same sweep) -
> do not mint 2nd ticket"). The human directive quoted below survives
> verbatim in BL-978's `notes:`, as does the "do not fix by raising the
> threshold alone" framing. The sibling guard half (the supervisor false
> halt) is **BL-977**.

# INTAKE 2026-08-20 — handoffd freshness restart-storm recurrence #2 (dropped-parcel-sweep)

**Raised by:** human, in-chat directive to the coordinator, 2026-08-20 ~08:32Z:
> "treat the handoffd intake as a high priority deffect"

**Related prior work:** `backlog/archive/INTAKE-handoffd-freshness-restart-storm-recurrence.md`
→ `backlog/done/M8/BL-967-handoffd-cycle-stall-bounded-waits-and-sweep-boundaries.yaml`
(defect/high, expedited, landed). BL-967 fixed the chase-sweep-tail stall
signature. **This is a different signature, observed live after BL-967 landed
— not the same defect recurring, a new one.**

## Symptom (live, observed by the coordinator during a routine sweep)

`freshness-incidents.log` shows a continuing restart-storm pattern, same shape
as the original intake (threshold=300s for handoffd):

```
epoch=1787204281 (05:38:01Z) age_secs=361 action=restart
epoch=1787204642 (05:44:02Z) age_secs=349 action=restart
epoch=1787205001 (05:50:01Z) age_secs=348 action=restart
epoch=1787205600 (06:00:00Z) age_secs=396 action=restart
epoch=1787212800 (08:00:00Z) age_secs=327 action=restart
```

All of these are **after** BL-967 landed, so BL-967's fix did not eliminate
the storm — it changed which sweep is slow.

## Root cause candidate, captured live at 2026-08-20T08:31:19Z

Current cycle-0 log for the live `handoffd` process (pid 37261, started
09:27 local / restarted since the incidents above):

```
2026-08-20T08:27:38.199344Z heartbeat cycle=0-start
2026-08-20T08:27:44.387797Z sweep-boundary sweep=chase-sweep ms=6183
2026-08-20T08:27:51.119375Z sweep-boundary sweep=dispatch-gap-sweep ms=6731
2026-08-20T08:27:57.663534Z sweep-boundary sweep=unassigned-active-nudge-sweep ms=6544
2026-08-20T08:27:57.672564Z sweep-boundary sweep=open-slot-nudge-sweep ms=9
2026-08-20T08:31:19.830303Z sweep-boundary sweep=dropped-parcel-sweep ms=202158
```

`dropped-parcel-sweep` alone took **202,158ms (~202s)** — by itself over
two-thirds of the 300s freshness budget, on top of ~19.4s already spent in
the chase/dispatch/nudge sweeps ahead of it. This cycle happened to finish
(~231s total by the time resource-sample-sweep completed at 08:31:29Z) and
did not trip a restart, but the incident log above shows ages of 327-396s
recurring roughly every 6-10 minutes, so this sweep is clearly landing over
budget on other cycles.

This is the same shape of problem BL-967 fixed for `chase-sweep` tail /
silent post-chase sweeps — a single sweep with no bounded wait blowing the
whole cycle's freshness budget — just in a different sweep
(`dropped-parcel-sweep`) that either regressed after BL-967, or was already
slow and only became the visible bottleneck once chase-sweep's own tail was
fixed.

## Human directive

> "treat the handoffd intake as a high priority deffect" (verbatim, in-chat,
> 2026-08-20 ~08:32Z)

Direction (not mandate, consistent with the prior intake's framing): mint a
defect, severity high (matching BL-967's precedent for the same failure
class — a single sweep in handoffd's cycle-0 loop with no bounded wait,
causing the daemon to blow the freshness threshold and be killed/restarted
by `daemon_log_freshness_check.sh`). Identify why `dropped-parcel-sweep`
specifically takes ~200s and bound it the same way BL-967 bounded the
chase-sweep tail — do not fix by raising the threshold alone (same rationale
BL-967's intake gave: this is silence with no end-of-cycle heartbeat, not
slow-but-healthy work).

This is not currently a swarm-down emergency — cool-off/restart keeps it
self-healing, at the cost of handoff latency, chase freshness, and repeated
daemon restarts roughly every 6-10 minutes.

## Evidence paths

- `.swarmforge/daemon/handoffd.log` — current-cycle sweep-boundary timings
  (dropped-parcel-sweep ms=202158 at 2026-08-20T08:31:19.830303Z)
- `.swarmforge/daemon/freshness-incidents.log` — restart history + ages
  (5 restarts between 05:38Z and 08:00Z today, all post-BL-967)
- `swarmforge/scripts/daemon_log_freshness.conf` — threshold=300 for handoffd
- Prior/fixed defect: `backlog/done/M8/BL-967-handoffd-cycle-stall-bounded-waits-and-sweep-boundaries.yaml`
