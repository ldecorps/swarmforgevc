# Raw intake — babysitterd pipeline-code-on-main re-walks every SHA ahead of swarmforge-QA every tick (cache + batched ancestry)

Status: **new intake, not minted.** Capture only (human via Cursor, 2026-08-23
~01:33 BST / 00:33Z, WSL host).

Human ask (verbatim this session): file an intake for engineering fixes
**(1) cache pipeline-code-on-main until tip / `swarmforge-QA` moves** and
**(2) one batched git gather, not N per-SHA shell scripts** — the two
highest-leverage ways to fasten the babysitter sweep. Treat as **one**
ticket (1+2), not two.

Sibling context (same Cursor session): Approvals/push-sweep intake
`INTAKE-push-sweep-cache-qa-refusal-and-single-ahead-gather.md` is the
same cost class on the handoffd side; this intake is the babysitterd
mirror (`gather-pipeline-code-on-main` in `babysitter_check.bb`).

## Observed (live, WSL)

### Freshness symptom (why this matters)
`FRESHNESS_VIOLATION escalate swarm=primary daemon=babysitterd age_secs=1146
reason=stale-heartbeat threshold=600 (cool-off; no second restart)` and a
restart/escalate storm on 2026-08-22 ~12:00–13:04 UTC.

Babysitterd writes its freshness `heartbeat` **only after**
`babysitter_check.sh --nudge` finishes (`babysitterd.sh` tick: check →
heartbeat → sleep 300s). A long check therefore looks like a dead daemon
to `daemon_log_freshness_check.sh` (threshold **600s**).

### Sweep timing (same log)
Implied check durations (gap between heartbeats minus the 300s sleep),
2026-08-22 morning/midday:

- Routine: check ~250–300s (already near the freshness budget once sleep
  is included)
- Spikes: check ~635s / ~661s / ~719s between heartbeats
- One ~75 min gap included a freshness **restart** mid-stall
  (`babysitterd start` at 11:34 / 12:32 / …)

Tonight the same check is ~3s wall-clock when the ahead-of-QA set is
cheap — so this is **load × SHA-set size**, not a permanent 10-minute
baseline.

## Why this costs (code shape)

`babysitter_check.bb` → `gather-pipeline-code-on-main` (BL-631):

1. `git rev-list swarmforge-QA..<ref>` for **both** `main` and
   `origin/main`
2. For **every** distinct SHA: shell `is_qa_ancestor.sh <sha>`
   (`qa-ancestor?`)
3. For every non-ancestor: `commit-touched-paths` / merge adjudication
   (more `git diff-tree` / `diff --quiet` / parent walks per SHA)

No cache keyed on tip SHA or `swarmforge-QA` tip. Identical refs →
identical full walks every 300s tick. Under host load (and after
freshness kills mid-check), ages climb into the 600–1146s escalate
window.

Related prior work (do not regress):

- **BL-631 / BL-925 / BL-962** — pipeline-code-on-main finding, shared
  `is_qa_ancestor.sh` predicate, merge adjudication. Caching/batching must
  preserve fail-closed ancestry and merge semantics.
- **BL-978** (done) — same “recompute every tick with no invalidation key”
  class on `dropped-parcel-sweep`.
- Push-sweep sibling intake (same session) — do not merge tickets; different
  daemon, different gather, shared *design pattern*.

## Wanted fix (direction for specifier — one ticket, two invariants)

**1. Cache until tip / `swarmforge-QA` moves**

When `main` tip, `origin/main` tip (if present), and `swarmforge-QA` tip are
unchanged vs the last successful gather, reuse the prior
`{:offending-commits :ancestry-unavailable?}` result. Invalidate on any tip
move or on a prior `:ancestry-unavailable?` / gather failure (must not
cache a fail-closed hole as “clean forever”).

**2. Batched ancestry gather when a gather *is* required**

Replace the per-SHA `is_qa_ancestor.sh` process storm with one batched
plan (single `rev-list` / merge-base strategy, or equivalent bb-native
pass) that still answers the **same** “is this SHA QA-approved?” predicate
BL-925 owns. Then run path/merge adjudication only on the non-ancestor
set. Pure assemble/adjudicate helpers stay the source of truth; this is a
data-access / process-spawn change.

Out of scope for this ticket (named follow-ons only):

- Heartbeat-before/mid heavy gather / sweep-marker (recommendation #3 —
  freshness false-positive guard, not sweep speed).
- Hard wall-clock abort of the gather (recommendation #4).
- Throttle gather to every N ticks (recommendation #5).
- Raising babysitterd’s 600s freshness threshold — not a fix.
- Operational “advance swarmforge-QA / clear non-QA tip” — helpful ops,
  not the ticket.

## Suggested classification (human preference, not mandate)

- `type: defect` (performance) — unpaid O(ahead-of-QA) work on the
  babysitterd poll thread every tick; direct trigger of freshness
  restart/escalate storms when the check overruns 600s of silence.
- Severity: **medium** while tonight’s checks are ~3s; **high** if the
  specifier weights the live 12:00Z restart storm / age_secs=1146
  escalate. Human leans: treat as worth minting with the push-sweep
  sibling, not polish-only.
- Do **not** weaken BL-631/925/962 refuse / fail-closed semantics.

## Evidence paths

- `.swarmforge/babysitterd/babysitterd.log` — heartbeat gaps and
  `babysitterd start` lines during 2026-08-22 10:21–13:04Z
- `.swarmforge/daemon/freshness-incidents.log` — babysitterd
  `stale-heartbeat` restart/escalate chain (ages 625–925+; announce
  `age_secs=1146` in cool-off)
- `swarmforge/scripts/babysitterd.sh` — heartbeat only after check
- `swarmforge/scripts/babysitter_check.bb` — `gather-pipeline-code-on-main`,
  `qa-ancestor?`, `offender-row`
- `swarmforge/scripts/daemon_log_freshness.conf` — babysitterd|600

## Human directive

> "intake for 1 & 2" (verbatim, Cursor session 2026-08-23 ~01:33 BST) —
> mint **one** ticket covering cache-until-tip/QA-moves **and** batched
> ancestry gather for babysitterd’s pipeline-code-on-main path.

---

**DISPOSITIONED 2026-08-23 by the specifier.** Drained 1:1 into **BL-1086**
(`backlog/paused/BL-1086-babysitterd-rewalks-every-sha-ahead-of-qa-every-tick.yaml`,
acceptance `specs/features/BL-1086-babysitterd-caches-and-batches-its-qa-ancestry-gather.feature`).

One ticket, not two, per the verbatim human directive "intake for 1 & 2",
carried into the ticket's `source:` unchanged along with the intake's own 1+2
framing and its "Do not weaken BL-631/925/962 refuse / fail-closed semantics"
constraint (Article 5.3).

**Kept separate from its sibling, as instructed.** The intake's "do not merge
tickets; different daemon, different gather, shared design pattern" is
honoured: BL-1085 is the push-sweep/handoffd side, BL-1086 is this one.

Specifier decision the intake explicitly left open: **severity high**, not
medium. Reasoning recorded in the ticket's `approval_context` — this defect
does not merely waste time, it misrepresents the daemon as dead (heartbeat is
written only after the check returns, `babysitterd.sh` line 36 vs line 32),
which induced a real restart/escalate chain with `age_secs=1146` against a
600s threshold, and the triggering conditions are present now. The sibling
stays medium because it breaches no budget. The human is offered a one-word
reversal to medium in `approval_context` if the expedite lane matters more.

Verified in the tree before scoping: heartbeat-after-check ordering
(`babysitterd.sh` 32/36); the 600s threshold (`daemon_log_freshness.conf`
line 5); `qa-ancestor?` shelling `is_qa_ancestor.sh` once per SHA
(`babysitter_check.bb` 291, resolved at 266); and the fail-closed hole at
line 401.

The design tension part 2 has to resolve is stated in the ticket rather than
left for the coder to discover: `babysitter_check.bb` lines 230-247 document
the per-SHA confirmation as deliberate belt-and-suspenders and forbid "a
second git merge-base invocation" (BL-925 invariant 2). So batching must mean
the SAME predicate answering for many SHAs in one process — `is_qa_ancestor.sh`
gaining a batch mode — not the caller deciding ancestry for itself.

Follow-on #3 (heartbeat before/during the heavy gather) is recorded in
`out_of_scope:` with a note that it is the right companion fix and becomes
urgent if BL-1086 proves slow to land. #4 and #5 likewise recorded, none
minted.
