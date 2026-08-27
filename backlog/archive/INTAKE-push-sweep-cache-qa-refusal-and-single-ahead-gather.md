# Raw intake — push-sweep re-proves the same QA refusal every heavy cycle (cache refusal + one ahead-range gather)

Status: **new intake, not minted.** Capture only (human via Cursor, 2026-08-23
~01:22 BST / 00:22Z, WSL host).

Human ask (verbatim this session): file a ticket covering engineering fixes
**(1) cache QA/noop refusal until tip or ahead-SHA set changes** and
**(2) one ahead-range gather per tick** — the two highest-leverage
optimizations for tonight’s dominant `push-sweep` cost. Treat as one ticket
(1+2), not two.

## Observed (live, WSL, 2026-08-22T23:40Z–2026-08-23T00:14Z)

- Heavy bundle runs ~every 10s (`chase-sweep-every-cycles`); heartbeats only
  at cycle start/end, so all ~23 sweeps run back-to-back between pulses.
- Current heartbeat gaps are ~10–14s total (not multi-minute). Dominant piece
  is **`push-sweep`**: p50 ~2s, max ~4.7s in the live `handoffd.log` window.
- Log is saturated with the same refusal every heavy cycle:

      push-sweep qa-refused non-qa-ancestor <same 5 shas…>
      sweep-boundary sweep=push-sweep ms=~2000–4700
      master-main-reconcile drift ahead=23 behind=0

- Local `main` is ~23 commits ahead of `origin/main` with a stable set of
  non-QA-approved (or bounced) offending SHAs. Push backoff never engages:
  backoff only applies *after* the QA/noop gates pass (`push_sweep_lib.bb`
  `:should-push` branch). A refuse still pays full gather cost forever.

## Why this costs (code shape, not speculation)

On every `:should-push` tick (`ahead>0`, `behind=0`), `push_sweep_lib/sweep!`
unconditionally:

1. `rev-counts!` → `git fetch` + `rev-list origin/main...main`
2. `noop-merge-gate-facts!` → enumerate **all** ahead SHAs (multi git
   diff/rev-parse per SHA)
3. `qa-gate-facts!` → enumerate **all** ahead SHAs **again** (QA ancestor /
   bounce / changed-paths per SHA)

There is no cache keyed on tip SHA / ahead-SHA set. Identical tip + identical
offending set → identical full walks every ~10s.

Related prior work (do not regress):

- **BL-978** (done) fixed the multi-minute `dropped-parcel-sweep` quadratic
  walk — different sweep, same class of “recompute every tick with no
  invalidation key”.
- **BL-630 / BL-855 / BL-952** — QA gate + noop-merge gate + removal of the
  tip-is-QA-ancestor *skip enumeration* fast path. Caching must invalidate
  when tip or ahead set changes; it must **not** restore the BL-952 tip
  fast path that skipped ahead enumeration.

## Wanted fix (direction for specifier — one ticket, two invariants)

**1. Cache QA/noop refusal until tip or ahead-SHA set changes**

When the last tick refused with `:non-qa-ancestor` / `:bounced-parcel` /
`:noop-landing-merge` (etc.) and the current `main` tip plus the ordered
ahead-SHA set are unchanged vs the cached key, skip re-running
`noop-merge-gate-facts!` and `qa-gate-facts!`. Re-gather whenever tip moves,
`origin/main` moves (ahead set changes), or gather previously failed closed.

**2. One ahead-range gather per tick**

When a gather *is* required, walk the ahead range **once**, produce shared
commit facts, then run both pure decisions (`noop-merge-decision`,
`qa-gate-decision`) on that one fact set. Today the two adapters each walk
the full range independently.

Out of scope for this ticket (named follow-ons only):

- Backoff-on-refuse cadence (recommendation #3 from the same session).
- Sharing `rev-counts!` / fetch with `master-main-reconcile` in the same
  heavy cycle (recommendation #4).
- Mid-bundle heartbeat (recommendation #5).
- Raising `daemon_log_freshness.conf` thresholds — not a fix.
- Operational “reset local main” — helpful ops, not the ticket.

## Suggested classification (human preference, not mandate)

- `type: defect` (or performance defect) — sustained unpaid work on the
  handoffd poll thread every heavy cycle while a non-QA tip sits unpublished.
- Severity: **medium** (tonight’s gaps are ~10–14s, under the 120s freshness
  budget) unless the specifier judges the ahead-range growth risk raises it.
- Do **not** fix by weakening BL-630/855/952 refuse semantics.

## Evidence paths

- `.swarmforge/daemon/handoffd.log` — repeated `push-sweep qa-refused
  non-qa-ancestor` + `sweep-boundary sweep=push-sweep ms=…` (2026-08-22
  night / 2026-08-23 early UTC).
- `swarmforge/scripts/push_sweep_lib.bb` — `sweep!` `:should-push` branch
  (noop gate then QA gate; backoff only after both pass).
- `swarmforge/scripts/handoffd.bb` — `push-sweep-qa-gate-facts!`,
  `push-sweep-noop-merge-gate-facts!` (two independent ahead walks);
  heavy-bundle cadence wrapping `push-sweep`.

## Human directive

> "file in ticket 1+2" (verbatim, Cursor session 2026-08-23 ~01:22 BST) —
> mint **one** ticket covering cache-until-tip/ahead-set-changes **and**
> single ahead-range gather per tick.

---

**DISPOSITIONED 2026-08-23 by the specifier.** Drained 1:1 into **BL-1085**
(`backlog/paused/BL-1085-push-sweep-re-proves-the-same-refusal-every-cycle.yaml`,
acceptance `specs/features/BL-1085-push-sweep-caches-its-refusal-and-gathers-once.feature`).

One ticket, not two, per the verbatim human directive "file in ticket 1+2",
which is carried into the ticket's `source:` unchanged along with the intake's
own 1+2 framing and its "Do not fix by weakening BL-630/855/952 refuse
semantics" constraint.

Specifier decisions recorded in the ticket rather than left implicit:
`type: defect`, `severity: medium` (agreeing with the intake's suggested
classification on its own merits — 10-14s gaps against a 120s freshness
budget); three invariants, of which the load-bearing one is verdict
EQUIVALENCE rather than a description of the cache key, because the risk here
is a silently stale refusal rather than a slow one; and a naming constraint
(`ahead-range-facts`) so `required_wiring` can see the shared gatherer is
actually what the adapters map points at.

Verified in the tree before scoping, not taken on trust: both gate adapters in
`handoffd.bb` (lines 2657 and 2728) do each call `git-ahead-shas` and walk the
full range; `push-sweep-qa-gate-facts!` already computes `main-tip` and
discards it; and `push_sweep_lib.bb`'s injected `adapters` map (documented at
lines 288-300) is the seam both halves fit behind without touching the pure
decision functions.

The risk trade — part 2 alone is a pure speedup with no verdict risk, part 1
adds branching in front of three safety gates — is surfaced in the ticket's
`approval_context` for the human to rule on, rather than split unilaterally
against the directive.

All named follow-ons (#3 backoff-on-refuse, #4 shared `rev-counts!`/fetch,
#5 mid-bundle heartbeat) are recorded in the ticket's `out_of_scope:` and are
NOT minted — they remain available to file when wanted.
