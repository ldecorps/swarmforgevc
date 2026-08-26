# Front-desk build-stale restarts must not burn the crash give-up budget (BL-1154)

## What you'll see

When `main` moves faster than a front-desk child can finish recompiling and
serving, the supervisor may roll that child onto a fresh Node build (BL-582).
That is a **voluntary** stale-build restart — the process was healthy; the build
was just behind `main`.

Before BL-1154, those rolls used the same crash-restart path as a true
unsuccessful exit. Each roll incremented `:attempts`, so heavy build-stale churn
alone could exhaust `FRONT_DESK_MAX_ATTEMPTS` (default 5), enter `gave-up`, and
trigger escalation email — even with no crash loop. That false give-up often
appeared alongside the repeat-mail window BL-1151 closed.

## What changed

Voluntary build-stale restarts now use a separate `"stale-build"` status in
`front_desk_supervisor_lib.bb`:

| Path | `:attempts` | Give-up budget |
| --- | --- | --- |
| Crash / stall / poll-heartbeat stale (`"waiting"` / `"stalled"`) | Incremented on each restart | Read by `decide-restart-action`; may reach `gave-up` |
| Voluntary build-stale roll (`"stale-build"`) | **Preserved** via `voluntary-build-stale-started-entry` | **Never read** — cannot alone exhaust the budget |

Backoff spacing is shared (same `compute-backoff-ms` timing), but only the crash
path feeds the give-up cap. True crash loops still reach `gave-up` and may
escalate once per episode (BL-1151).

Log cues in `.swarmforge/operator/front-desk-supervisor.log`:

- `:build-stale-detected` / `:build-stale` — staleness observed; a voluntary roll
  may follow after grace (`FRONT_DESK_BUILD_GRACE_MS`, default 300000).
- `:build-stale-deferred` — child has not yet served the build it was restarted
  onto; restart is owed but deferred (BL-1037).
- `:gave-up` after only build-stale churn (no `:crashed` / `:stalled`) on a build
  with this fix landed → treat as a regression.

Pure policy lives in `front_desk_supervisor_lib.bb` → `check-one!` /
`voluntary-build-stale-started-entry`. No new extension command or setting.

## Operator response

1. Tail `front-desk-supervisor.log` and count whether `:gave-up` followed
   `:crashed`/`:stalled` events or only build-stale churn.
2. If the child is crash-looping, fix the underlying bridge/bot failure (token
   conflict, port bind, etc.) — give-up on a real crash loop is intentional.
3. If only build-stale rolls were firing, confirm this fix is on the running
   supervisor build (`BUILD_SHA` / git tip) and that `:attempts` stays flat
   across `:build-stale` cycles in the log.
4. For repeat give-up email on the same outage, see
   [BL-1151 give-up one email per episode](BL-1151-front-desk-giveup-one-email-per-episode.md).

## Related

- [BL-1151 — give-up one email per episode](BL-1151-front-desk-giveup-one-email-per-episode.md)
- Spec BL-582 — build-freshness watchdog and voluntary stale-build rolls.
- Spec BL-1037 — defer restart until the child has served the build it landed on.
- Spec BL-370 — bounded restart then give-up for true outages.

Acceptance:
`specs/features/BL-1154-build-stale-restarts-not-crash-giveup-budget.feature`
