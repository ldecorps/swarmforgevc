# Answer — the machine-triggered restart (2026-08-28, asked via role_ask; answered ~14:50 BST)

Question raised to the human immediately after discovering that an
`expedite.sh BL-1248` teardown had restarted the swarm at 14:30 BST, against
the human's own 10:54Z `Hold restart, do not push, wait for QA` directive and
against the standing BL-1191 ops hold:

> Your 10:54Z 'hold restart' was overridden by a machine: an expedite.sh
> BL-1248 teardown ran ./start-swarm.sh at 14:30 and the full pack is up now.
> That expedite FAILED at coder, so the kill switch is still unbuilt and the
> master-main-reconcile sweep is running unguarded, with 19 unpushed commits on
> main including your BL-1247 and BL-1248 approvals. Minted BL-1249 so the
> expeditor reads control-pause.json in future. For right now: leave the swarm
> running, or stop it?

Three options were offered: leave it running / stop it now / stop it and
re-expedite BL-1248 with `--no-restart`.

**Human: "Stop it, then expedite BL-1248 with --no-restart."**

## Disposition

- **The directive is a single command.** `expedite.sh` stops the swarm itself
  as its initiation phase, so `./swarmforge/scripts/expedite.sh BL-1248
  --no-restart` satisfies both halves: it stops the pack, drives BL-1248
  through every gate with the stack down, and skips the final restart. No
  separate stop step is wanted or needed.

- **It CANNOT be launched from inside the swarm, and was not.** Verified
  mechanically rather than assumed:
  `kill_pipeline_swarm.sh:snapshot_pane_descendants` runs BEFORE any teardown
  and recursively collects every descendant of every tmux pane pid via
  `pgrep -P`; `reap_orphaned_pane_descendants` then `kill -KILL`s all of them.
  The specifier agent is pane pid 1437535's descendant, so anything it spawns
  is captured in that snapshot. `setsid`, `nohup` and `disown` do not help —
  the snapshot reads PARENT links, which are intact at snapshot time. An
  expedite launched from this seat would be killed by the very stop it
  initiated, leaving a stopped swarm, a half-run expedite with tickets already
  parked into `backlog/hold/`, and no live agent to report it.

  Handed back to the human to run from a shell outside the swarm's process
  tree — which is how the 14:30 run itself was launched (`"by":"cli"`).

- **The 14:30 run's failure was not a spec defect, so a re-run is worth it.**
  Its coder stage returned `no-verdict` with a 58-byte transcript reading, in
  full: `I'll wait for the Monitor notification before continuing.` The stage
  agent ended its turn waiting instead of working. Nothing about BL-1248
  caused it and nothing needs fixing before a retry.

- **The re-run resumes from real work, not from scratch.** The 14:30 run's
  specifier stage PASSED and committed `d604d5819` to `expedite/BL-1248`,
  which is checked out at `.worktrees/expedite-BL-1248` and is NOT an ancestor
  of `main`. It resolved a genuine internal contradiction in the ticket — the
  guard must sit at the `:should-reconcile` branch inside
  `master-main-reconcile-lib/sweep!`, NOT at the `handoffd.bb` call site,
  because `:surface!` and `:escalate!` are injected into that same call and
  guarding the call site would silence drift logging and escalation along with
  the reconcile — and added scenario 05 to gate it. That work is preserved on
  the branch.

- **The restart hold's status is unchanged by this answer.** `--no-restart` is
  explicitly chosen, so the swarm stays down after the run. The BL-1191 hold
  remains undischarged and the do-not-push half of the 10:54Z decision remains
  in force.

- **BL-1249** (minted this turn, defect/high, `human_approval: pending`) is the
  durable fix: the expeditor must read `.swarmforge/operator/control-pause.json`
  and decline the restart loudly while a hold is in force. Until it lands,
  `--no-restart` is the only lever, and it must be passed by hand on every
  expedite run made while a hold stands.
