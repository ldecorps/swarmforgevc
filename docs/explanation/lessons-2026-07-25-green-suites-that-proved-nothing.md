# Lessons from 2026-07-25: green suites that proved nothing

One session. A pre-QA landing on `main`, a post-mortem, nine tickets filed, and one
tool built by hand through all seven pipeline gates. Nearly every finding was the
same shape:

> **Something reported success while proving nothing — and the report was
> indistinguishable from a real one.**

Organised by pattern rather than chronology, because the pattern is what transfers.
Dates and ticket ids are here so each claim can be checked.

---

## 1. A green suite is not evidence

Six separate instances in one day. This is the through-line.

### The mutation gate that generated zero mutants

Running the BL-113 Gherkin acceptance mutator on a feature file produced:

```
Total 0 | Killed 0 | Survived 0 | Errors 0
manifest: {"scenarios":[], "implementation_hash":"unknown"}
```

`discover` in `swarmforge/vendor/aps/bb/src/aps/mutation.clj` iterates
`(:examples scenario)` — it mutates **Examples-table cells only**. A feature with no
Scenario Outlines gives it nothing to work with. Zero mutants reads exactly like a
clean sweep.

Worse: the mutator **writes a `# mutation-stamp` into the feature file**, so a later
run skips as "already done" on the strength of a run that generated nothing.

**Repo-wide, not one ticket's problem.** Any outline-free feature is affected.

### The test that could not fail

A test added specifically to cover a guard:

```clojure
;; guard: return nil rather than the next flag when a value is missing
(when (and v (not (str/starts-with? (str v) "--"))) v)

;; the test
(assert= "a missing value does not swallow the next FLAG"
         nil (:bounce-bound (parse-args ["/r" "BL-1" "--bounce-bound" "--dry-run"])))
```

Green. And **vacuous** — because:

```
flag-value with the guard  -> nil
parse-long "--dry-run"     -> nil
```

The `nil` came from `parse-long`, not from the guard. Deleting the guard changed
nothing observable. The test measured the wrong thing while looking like coverage,
and only a mutation sweep found it.

**Lesson:** assert on the function that holds the invariant, not on a downstream
value that happens to agree.

### The fixture that encoded the author's assumptions

A driver dispatched on stage verdicts: `pass` advances, `bounce` retries, anything
else fails. 53 CLI assertions and 21/21 acceptance, all green.

Then a **real** agent session returned `forward` — a documented, and in that case
correct, role outcome. The run failed on a role doing exactly the right thing.

The test fixture had only ever emitted `pass` or `bounce`. **The green suite was
measuring agreement between two things the same author wrote**, not agreement with
the system.

**Lesson:** a seam you control cannot validate your model of something you do not
control. That is the entire argument for exercising the real path at least once.

### The generator that never reached the interesting state

A property suite: 8 properties, 500 runs each, all holding. Then coverage was
measured:

```
probe coverage: stopped=2  live=498
```

The property "if the swarm reads as stopped then nothing is alive" saw a stopped
swarm **twice in 500 runs**. A naive independent draw over four booleans and two
counts makes the interesting case ~0.5% likely.

Fixed by drawing the *shape* first — a third fully stopped, a third with exactly one
thing alive, a third arbitrary → `stopped=166 live=334`. Coverage is now **asserted**:
the suite fails if either branch drops below 10% of runs.

**Lesson:** for generative tests, measure and assert the generator's reach. A
property that never reaches its interesting input is decoration.

### The timeout whose scenario passed because the fixture returned

A stage timeout was computed *after* a blocking call, so it could only ever describe
a stage that had already finished. A genuinely hung stage blocked forever.

Its scenario passed — because the fixture's "slow" stage slept two seconds and
**returned**. It was never hung.

**Lesson:** name what the fixture actually does. "Slow" and "hung" are different
failure modes, and only one of them was tested.

### The property that could not fail alone

Eight properties. Breaking each invariant in turn proved seven fail independently.
The eighth could not: another property recomputed the same expectation from the same
inputs, so no break failed one without the other.

Recorded as **subsumed — a regression sentinel, not an independent property**. Left
in place for the specific historical bug it watches, but not counted as evidence.

**Lesson:** proving a test suite can fail is a separate activity from running it, and
sometimes the honest result is "this one is redundant."

---

## 2. Tools that lie about their own success

### `./stop-swarm.sh` printed "clean slate" with two daemons running

```
2026-07-25T12:06:08Z kill_all_swarm SUCCESS — clean slate
```

Still alive after that line:

```
./.swarmforge/operator/babysitterd.sh   up 1d08h — 5-min sweeps that nudge agents
claude --remote-control Operator        up 2d06h — recovers a swarm it finds down
```

`stopping babysitter` had succeeded against the *wrong* babysitter: there are two,
and the stop path knows only `.swarmforge/babysitter/`, whose log had been stale for
three days. The live one is operator-launched and unknown to the stop path.

**Ticketed BL-637.** The structural fix matters more than the coverage: **verify
before printing "clean slate."** A teardown that claims success while daemons run is
worse than one reporting a partial stop, because the operator stops checking.

### `kill -KILL -<pgid>` exits 0 and leaves every grandchild alive

```
kill -KILL -PGID        rc=0  survivors=2     WRONG, and silent
kill -KILL -- -PGID     rc=0  survivors=0     correct
```

`/usr/bin/kill` reads `-<pgid>` as an *option*, not a negative pid. The `--`
separator is load-bearing and its absence is completely silent.

Related, from the same fix: `.destroyForcibly` kills the direct child only, so a
shell script's own children survive; and deref-ing a destroyed process **blocks**
while a surviving grandchild holds the stdout pipe, because EOF never arrives.

### `kill_all_swarm.sh` is the one that does not kill all

| entry point | scope |
|---|---|
| `./start-swarm.sh` | **full stack** (pipeline + ancillaries) |
| `./stop-swarm.sh` | **full stack** (ancillaries first, then the rest) |
| `./swarm` | pipeline only |
| `./swarm-kill` | pipeline only |

The name with "all" in it is the **innermost** layer. And the operator's own durable
teardown note said `Stop: ./swarm-kill` — the narrow one — for fifteen days. Two
readers reached for the wrong tool, fifteen days apart, one of them writing the
error into a procedure.

**Lesson:** a name that makes a competent reader reach for the wrong tool is a defect
in the name. Also **BL-637**.

### `push-sweep` reports "up-to-date" while local `main` is behind

By design (`push_sweep_lib.bb`): `ahead = 0` → `:nothing-to-push`, regardless of
`behind`. The sweep pushes, it never pulls. Correct — but it means a local `main`
missing a commit that exists on origin logs "up-to-date" indefinitely, and nothing
surfaces it until the next commit jams into `:diverged`.

---

## 3. Calibrating a limit to the pathology ratifies it

A bounce bound was proposed at **8**, reasoned from a ticket that had legitimately
taken six architect send-backs that same day.

The operator rejected it: *"6 bounces is unacceptable, 3 barely. So 8, no way."*

The error is worth naming because it feels like evidence-based design. Calibrating to
the **worst observed case silently declares it acceptable**: if six rounds is
unacceptable, a bound of eight says six is fine. And the observed case was not the
target — other work exists specifically to stop tickets bouncing six times.
Calibrating against the state those tickets fix designs the pathology into the tool.

At 3 the bound also changes *meaning*: it stops being a runaway-loop backstop and
becomes a **quality signal**. Three rounds against one gate says the ticket is
probably mis-specified, so exhaustion names the repeated defect class and routes to
the specifier rather than blaming the coder.

**Lesson:** calibrate limits to the target, not to the measurement. And ask what
hitting the limit should *mean*, not just what it should stop.

---

## 4. Measurement contamination

Asked "how often do tickets bounce?", the obvious approach — counting commit
subjects — was contaminated **two independent ways**, and produced a confidently
wrong ranking.

**Title contamination.** `BL-115-bounce-watcher-resilience` and the BL-025/026/027
*bounce commands* rank top. A first pass put BL-115 first with 26 "bounces". It was
never bounced once.

**Propagation contamination.** One bounce produces five or six commits as its fix
travels coder → cleaner → architect → hardener, each merge subject repeating "bounce
fix". BL-509 scored 6 by this method; its real count is **one**, and that one was
merge damage rather than a spec defect.

Neither is fixable with a better regex.

What actually exists: `.swarmforge/qa_bounces/<YYYY-MM>.jsonl`, 53 records, already
seeded from the evidence corpus. But **only QA bounces are recorded** —
`record-qa-bounce.js` is invoked from one place, `QA.prompt`. The architect never
calls it, and the architect is where repeated bouncing actually happens.

Reading the QA log alone concludes "repeat bouncing does not happen here" (1 ticket
of ~52 in 15 days) — the exact opposite of the truth for architect send-backs.
**Ticketed BL-635**: generalise to `record-bounce --by <role>`, and never pool the
two classes.

### The self-match trap, three times in one day

```
pgrep -f handoffd.bb            # matched the auditing shell's own command line
ps -eo args | grep -c babysitterd   # invented phantom survivors
pkill -f 'sleep 3600'           # killed the shell running the test harness
```

The third one presented as an unexplained suite failure, twice, before the cause was
obvious.

**Lesson:** `pgrep -f` and `grep` match the auditing process too. Count by parsing
`ps` output and comparing argv exactly.

---

## 5. Where work lands, and what silently moves it

### The root cause of the pre-QA landing

Un-reviewed work reached `main` and `origin/main`. The first hypothesis — a
rotating-worktree lag under the mono-router — was **wrong**, and was corrected in
place.

The actual cause, from the role's own transcript: the cleaner prefixed
`cd /home/carillon/swarmforgevc` to its git commands, so it ran its whole pass in the
**master checkout, which has `main` checked out**. The parcel's own first instruction
(`merge_and_process`) executed there, making `main` the working branch for everything
that followed.

Nothing errored, because `main` already held the code from the cleaner's own bad
merge — the wrong-path reads returned plausible content.

**It is a habit, not a slip.** Seven sessions ran
`cd /home/carillon/swarmforgevc && npm run compile|npm test`. Harmless for `npm`,
catastrophic for `git`, and nothing in the environment distinguishes them.

Then `handoffd`'s `push-sweep!` published every commit to `origin/main` **within
15–140 seconds**, with no QA-ancestry check. That is what made it unrecoverable.

Four containment tickets: **BL-629** (deploy gate), **BL-630** (publish gate),
**BL-631** (deterministic detection), **BL-632** (commit-time guard).

### `hold/` and `paused/` are not interchangeable

Parking a ticket to `paused/` looks right and is wrong: `paused/` **is the promotion
queue**. A ticket there carrying `human_approval: approved` is promoted straight back
on the next boot — it un-parks itself, silently. `hold/` is a recognised live state
promotion does not read.

The difference only shows on the reboot *after* the decision.

### Tooling that restores to HEAD destroys uncommitted work

Two hand-rolled mutation scripts restored the file they mutated with
`git checkout -- "$LIB"` — to **HEAD**, not to what they found. Run either with an
uncommitted fix in that file and the fix vanishes.

It happened twice, and both times presented as **37 unrelated test failures**. The
first fix covered only one of the two scripts; the second had the identical line.

**Lesson:** a tool that mutates a file must restore what it found, not what git
remembers. And one instance of a bug this shape is rarely the only one — grep for the
sibling before declaring it fixed.

---

## 6. What good diagnosis looks like

The counter-example to everything above. One ticket took six architect send-backs,
and the send-backs got *better*:

```
#1  un-guarded durable writes in the facilitator turn      "guard this branch"
#2  idempotency guard misses redelivered batches           "guard this branch"
#3  unguarded no-active branch re-applies stale text       "guard this branch"
#4  re-paste at prerequisites-ready wipes the checklist    "the state-file KEY is wrong"
#5  distinct target repos share one state file             "the KEY is not injective"
#6  handler and store disagree on target identity          "TWO LAYERS, two definitions"
```

Each round climbed a level of abstraction. By #5 the architect wrote: *"Third instance
of one root cause — fixing the key ends the family instead of guarding one more
branch."* By #6 it had located the real fault: two layers holding two definitions of
the same identity, with the minimal counterexample being `http://` versus `https://`.

And #4 onward were found by **property tests**, not by re-reading code. P3 re-found
#3's defect unassisted; a fourth property failed with the minimal counterexample
`[ADVANCE x5, REPASTE_URL]`.

**Lesson:** repeated bounces circling one concern are a signal about the *spec*, not
the implementation. Three rounds on one class means an invariant was never stated —
which is why exhausting the expeditor's bounce bound now reports a probable spec
defect instead of blaming the coder.

---

## 7. Honesty as an engineering practice

Recurring across the day, and the habit worth keeping:

- **Correct a wrong premise in place.** A ticket whose stated root cause is wrong
  will produce a guard aimed at the wrong thing, which is worse than no guard because
  it reads as protection.
- **Say what a fixture cannot assert.** Where a scenario's wording sounds like it
  checks stage *content*, the handler checks the driver-side half and says so in a
  comment. The alternative is a fixture-only pass that reads like a real one.
- **Record subsumption.** A test that cannot fail independently is a sentinel, not
  evidence.
- **State the bootstrap.** A tool cannot have been built by itself; run #1 was
  human-driven, so a green result evidences the procedure, not the tool.
- **Refuse rather than proceed on an unrecognised input.** Guessing skips gates.

---

## Tickets from this session

| | |
|---|---|
| BL-629 | deploy gate — `sync` refuses a non-QA-approved `main` (root cause corrected) |
| BL-630 | publish gate — `push-sweep!` refuses the same |
| BL-631 | deterministic detection of pipeline work on `main` |
| BL-632 | commit-time guard (`pre-commit` + `pre-merge-commit`) |
| BL-633 | `invariants:` in the ticket schema — scenarios are examples, not properties |
| BL-634 | slice-size envelope at promotion |
| BL-635 | `record-bounce --by <role>` — architect send-backs are recorded nowhere |
| BL-636 | rotation preference ignores parcel priority |
| BL-637 | lifecycle script names lie about their scope |
| BL-567 | the expeditor — shipped this session, all seven gates |

## Related

- [Driving one ticket through every gate with the swarm stopped](../how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md)
- [Why the expeditor commands the stack but never depends on it](BL-567-why-the-expeditor-commands-the-stack-but-never-depends-on-it.md)
- `backlog/evidence/BL-567-{design,architect-pass,hardener-pass,qa-pass}-20260725.md`
- `backlog/evidence/BL-590-parked-20260725.md`
