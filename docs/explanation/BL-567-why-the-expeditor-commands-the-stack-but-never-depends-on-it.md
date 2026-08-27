# Why the expeditor commands the stack but never depends on it

The expeditor exists for one situation: **the swarm's own machinery is the thing
that is broken.** A defect in handoffd, in the mailboxes, in rotation or in the
coordinator cannot be fixed by a ticket that rides the pipeline it is breaking. The
fix would be dispatched by the dispatcher it repairs.

That single constraint explains nearly every design decision in it, including the
ones that look inconsistent at first.

## Dependence and command are not the same thing

The hard rule is that the expeditor may not invoke, require or assume handoffd, the
mailboxes, tmux sessions, rotation, `ready_for_next`, the coordinator, chase, the
babysitter or the operator runtime.

Yet its first act is to **stop all of them**, and its last is to **start them
again**. That is not a loophole. Needing a thing in order to do your work is
dependence; deciding when it runs is command. A recovery tool that could not turn
the broken thing off would be a strange recovery tool.

The line is drawn between **data** and **machinery**. Constitution articles,
`PIPELINE.md`, role prompts, pack configuration, backlog YAML, feature files, git
branches — all plain files under version control, all fair game. Anything that
requires a running daemon, a live socket or a mailbox write is out of reach even
when it would be convenient.

That is also why prompts are **composed fresh** through PromptEngine rather than
read from `.swarmforge/prompts/<role>.md`. That file is a build output: stale between
launches, absent entirely on a bare host. Composing from the sources is both more
correct and more compliant with the data-vs-machinery line.

## The asymmetry that matters most

Teardown **blocks**. Restart **does not**. Getting this backwards would smuggle the
forbidden dependency back in through an exit code.

Consider the primary use case again: you are repairing the start path. If the
ticket's verdict depended on a clean restart, then a repo with a broken
`start-swarm.sh` would make the expeditor report failure on work it had completed
perfectly — and the tool would become unusable at precisely the moment it is needed.

So the ticket is **done when QA stamps it and the yaml moves**. The restart runs
afterwards, reports its own outcome, and is loud on failure without retracting
anything.

There is a pleasing consequence. When the fix *is* the start path, the restart phase
becomes the **validation** of the fix: the first real user of the thing just
repaired, run automatically, with the expected live set as the assertion.

## It kills its own watchdog

Stopping the stack kills the babysitter and the Operator. Those are exactly the two
processes that would otherwise notice the expeditor itself hanging.

This is not incidental — it is forced by the design. And it means the expeditor must
observe itself: every stage is bounded, and on overrun the whole process group is
killed rather than just the direct child.

The first implementation got this wrong in an instructive way. It called a blocking
shell helper and computed the timeout verdict *afterwards*, so the verdict could
only ever describe a stage that had already returned. A genuinely hung stage blocked
forever. The scenario passed anyway, because the fixture's "slow" stage slept and
then **returned** — it was never hung. The guard was correct for the case it was
aimed at, with the real case uncovered.

Three further details, each silent:

- Destroying the direct child leaves a shell runner's own children running.
- Deref-ing a destroyed process blocks while a surviving grandchild holds the stdout
  pipe open, because EOF never arrives.
- `kill -KILL -<pgid>` **exits zero, kills only the group leader, and leaves every
  grandchild alive** — `/usr/bin/kill` reads `-<pgid>` as an option. The `--`
  separator is load-bearing.

## Why the bounce bound is 3 and not 8

The first design proposed 8, reasoned from a ticket that had legitimately taken six
architect send-backs the same week. That calibrates the limit to the **worst observed
case**, which silently ratifies it: if six rounds is unacceptable, a bound of eight
declares six acceptable.

The observed case is not the target. Other work exists specifically to stop tickets
bouncing six times — an `invariants:` section so specs state cross-cutting properties
rather than only examples, and a slice-size envelope at promotion. Calibrating
against the state those fix would design the pathology into the tool.

At 3, the bound stops being a runaway-loop backstop and becomes a **quality signal**.
Three rounds against one gate says the ticket is probably mis-specified, not that the
coder is failing. So exhaustion names the repeated defect class, routes to the
specifier, and explicitly declines to blame a stage.

With one honesty clause: if the three rounds show three *unrelated* classes there is
no evidence of a mis-specified ticket, and the run says so instead of claiming one on
weaker evidence.

## Why `hold/` and not `paused/`

`paused/` is the promotion queue. A ticket parked there carrying
`human_approval: approved` is promoted straight back on the next boot — it un-parks
itself, silently. `hold/` is a recognised live state that promotion does not read.

The difference only shows up on the reboot after the run, which is exactly the kind
of defect that survives review and gets found in production.

## Liveness is a probe, never a glob

The interlock was first specified as a check on `.swarmforge/tmux/*.sock`. Measured
on a verifiably stopped swarm: `tmux list-sessions` answered *no server running*
while the socket **file** was still present, because the teardown deliberately leaves
it behind.

A glob-based check therefore reads a clean slate as live and refuses on the exact
state the expeditor exists for. The operator then passes `--override` as a matter of
routine, and the interlock becomes decoration. **The file is not the signal; the
server answering is.**

The same reasoning widened liveness beyond handoffd. A teardown that printed
`SUCCESS — clean slate` left `babysitterd` (five-minute sweeps that nudge agents) and
the Operator agent (whose job is to recover a swarm it finds down) both running.
Either one can interfere with an offline run, so both are part of liveness.

## The bootstrap admission

The expeditor cannot have been built by the expeditor. Its first traverse was driven
by hand, and that hand-run is the reference procedure the driver was written from.

This is recorded rather than smoothed over, because a green result from run #1 is not
evidence that the driver works — only that the procedure does.
