# What NOT to do when tweaking the swarm

Eighteen anti-patterns, each observed causing real damage in one session on
2026-07-25. This is the operational companion to
[Lessons from 2026-07-25: green suites that proved nothing](../explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md) —
**this page is the prohibitions, that page is the reasoning.** Extend or
link between them; do not restate one in the other.

You are about to modify the swarm. Read the group that matches what you're
about to touch.

## Where your edit actually lands

1. **Never run `git` from the master checkout while wearing a role hat.** A
   cleaner prefixed `cd /home/carillon/swarmforgevc` to its git commands and
   ran its whole pass on `main`. Nothing errored, because `main` already held
   the code from its own bad merge. `cd <root> && npm run compile|npm test`
   is harmless — `cd <root> && git ...` is not, and nothing in the
   environment distinguishes the two cases for you.
2. **Never `git add -A` in a shared checkout.** It swept the operator's
   uncommitted approval edits into a commit titled "By cleaner." Stage
   explicit paths.
3. **Park to `backlog/hold/`, never `backlog/paused/`.** `paused/` IS the
   promotion queue: an approved ticket parked there is promoted straight
   back on the next boot and un-parks itself, silently. The difference only
   appears on the reboot AFTER the decision.
4. **A source edit does not reach the agents by itself.** Role prompt build
   outputs and each role worktree's own copy of `articles/reference/` are
   generated/synced artifacts, not the constitution source. An amendment
   landed on `main` reached zero agents until the prompts were regenerated
   and the worktrees merged it.

## Tools that report success they did not achieve

5. **Never trust a teardown's exit code.** `./stop-swarm.sh` printed
   `SUCCESS — clean slate` with `babysitterd` and the Operator agent still
   running. Probe afterwards (`ps`, not the script's own exit status).
6. **`kill -KILL -<pgid>` needs `--`.** Without it, `kill -KILL -<pgid>` is
   parsed as an option string, exits 0, kills only the group leader, and
   leaves every grandchild alive. Silent. Use
   `kill -KILL -- -<pgid>` (see `swarmforge/scripts/kill_all_swarm.sh`,
   `swarmforge/scripts/kill_pipeline_swarm.sh`).
7. **`.destroyForcibly()` kills the direct child only** — a shell script's
   own children survive it. And deref-ing a destroyed process BLOCKS while a
   surviving grandchild still holds the stdout pipe open, because EOF never
   arrives.
8. **A zero-mutant mutation run reads as a clean sweep.** `Total 0 | Killed 0
   | Survived 0`, exit 0 — and the Gherkin acceptance mutator
   (`swarmforge/vendor/aps/bb/src/aps/mutation.clj`) iterates
   `(:examples scenario)`, i.e. Examples-table cells only. A feature file
   with no Scenario Outlines gives it nothing to mutate, and it still writes
   a `# mutation-stamp` into the feature file, so a later run skips it as
   "already done" on the strength of a run that generated nothing. (BL-638.)
9. **`push-sweep` can log `up-to-date` while local `main` is BEHIND** — an
   `ahead = 0` check short-circuits regardless of `behind`. Check both
   directions before trusting a sync-status line.

## Measuring and auditing

10. **`pgrep -f` and `grep -c` can match the auditing process itself.** Hit
    three times in one day; once `pkill -f 'sleep 3600'` killed the shell
    running the test harness and presented as an unexplained suite failure.
    Parse `ps` output and compare argv exactly instead of pattern-matching
    the whole command line.
11. **Never count anything by grepping commit subjects.** Two independent
    contamination modes: ticket TITLES containing the word (a ticket named
    `…-bounce-watcher-resilience` ranked top with 26 "bounces" and was never
    bounced once), and PROPAGATION (one bounce yields 5-6 commits as its fix
    travels the pipeline chain).
12. **Measure structure, not prose.** A count of features "with Scenario
    Outlines" was wrong because a comment merely MENTIONED the phrase. Match
    on `^\s*Scenario Outline:`, not a substring search.

## Tests that cannot fail

13. **Assert on the function holding the invariant, not a downstream value.**
    A test asserted a `nil` that actually came from `parse-long`, not from
    the guard it claimed to cover — deleting the guard changed nothing
    observable. Green for hours, proving nothing.
14. **A fixture you control cannot validate your model of something you do
    not.** A driver fixture knew only `pass`/`bounce`; a real agent returned
    `forward`, a documented role outcome, and the run failed against it. 53
    assertions and 21/21 acceptance were measuring agreement between two
    things the same author wrote. **Exercise the real path at least once.**
15. **Measure your generator's reach.** A property suite ran 8 properties x
    500 runs green while reaching its interesting state only twice in 500
    runs. Assert coverage of the state you care about, not just pass/fail.
16. **Name what the fixture actually does.** A timeout scenario passed
    because the "slow" stage merely slept and then RETURNED. It was never
    hung, so the report-only-timeout defect it was meant to catch survived
    it untested.

## Changing rules and tooling

17. **Never calibrate a limit to the worst observed case** — it ratifies it.
    A bounce bound of 8, derived from a ticket that took 6 send-backs,
    declares 6 acceptable going forward. Calibrate to the target behavior,
    not the worst incident on file.
18. **Tooling that mutates a file must restore what it FOUND, not HEAD.**
    Two mutation scripts used `git checkout -- <file>` to "restore" a file
    and silently destroyed uncommitted work — twice, each time presenting as
    ~37 unrelated test failures.

## The meta-rule, which earned its place twice

**One instance of a bug of this shape is rarely the only one.** The
impossible-ancestry check lived in two files and the first fix caught one.
The `git checkout --` defect (#18) lived in two scripts and the first fix
caught one. Both second instances cost a full re-run to find.
**Grep for the sibling before declaring a bug of this shape fixed.**

## The through-line

In almost every one of these eighteen, the failing thing REPORTED SUCCESS.
The swarm is largely self-observing, so the dangerous defects here are not
the loud ones — they are the ones that produce a green light. See
[Lessons from 2026-07-25](../explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md)
for the reasoning behind why each of these shapes recurs.

## Out of scope

Fixing any one of the eighteen — each already has its own ticket
(BL-629..632, BL-635..643) where one is warranted. This page is the written
record so the next person modifying the swarm does not have to rediscover
them from a day of git history that nobody can reconstruct later.
