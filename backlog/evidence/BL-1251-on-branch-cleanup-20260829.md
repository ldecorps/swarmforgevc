# BL-1251 — the ON-branch cleanup

Coder, 2026-08-29.

## The decision was already taken; this parcel is only its cleanup

The specifier's 2026-08-29 note is explicit: the operator re-armed the sweep in
`cce70d985` ("Re-arm master-main-reconcile (BL-1251 ON)"), and the framing that
this ticket carries the flip question to the human is spent — "do not re-ask
it". I did not re-ask it, and I did not touch the switch: `swarmforge.conf`
already reads `config master_main_reconcile_enabled true`, written by the
operator, and the ticket's firm constraint is that the flip needs a recorded
human answer, which it has.

## The fixed part of the qa_e2e procedure, true under either outcome

    $ grep -n master_main_reconcile_enabled swarmforge/swarmforge.conf
    345: config master_main_reconcile_enabled true

Matches the recorded decision (ON). The conf comment above it reads:

    # Originally shipped OFF until BL-1236 landed; BL-1236 closed 112027d99.
    # Operator decision 2026-08-29 (BL-1251 ON): re-arm after a live clean-tree
    # absorb proved merge-tree-clean and cleared a durable skipped-by-config
    # deadlock that was parking coordinator bookkeeping.

No expired condition: it records a decision already taken, not a condition
still pending. Nothing to rewrite there — the operator's own comment already
satisfies the requirement the OFF branch would have imposed.

## What this parcel actually changed

**1. Scenario 04 is RETIRED, not reworded.** It asserted the shipped conf sets
the key to `false`, which stopped being true the moment the operator flipped
it, so it was failing on main — the red-when-correct case its own RETIRE-WITH
marker anticipated and named BL-1251 as its retirer. In its place stands a
comment recording what it said, that it was retired, and why rewording it to
assert `true` would have been wrong: the shipped value is now an operator's
standing choice, not this ticket's deliverable, so an assertion pinning it
would invent a contract nobody agreed to.

**2. The Feature title and the step-handler FEATURE constant, together.** The
title lost ", and is off until BL-1236 lands"; `FEATURE` in
`bl1248MasterMainReconcileKillSwitchSteps.js` was changed to match in the same
commit. The ticket warns these are a matched pair and that changing one alone
unbinds every scenario in the file; the constant now carries a comment saying
so, so the next reader is not left to rediscover it.

**3. The narrative paragraph.** It claimed the lever was "still unbuilt" and
that the corrected predicate "has not yet run in production". Both had ended:
the lever is what BL-1248 built, and the operator's re-arm followed a live
clean-tree absorb. Re-tensed rather than left stating a false present (BL-1006).

**4. Scenario 04's two step handlers went with it.** The runner throws on a
MISSING handler and is content with a spare one, so leaving them would have
been harmless — but a handler asserting the sweep ships OFF would have outlived
the only scenario that ever asked, and read to the next person as a contract
that still holds. The now-unused `node:fs` import went with them; the
remaining `fs` mentions in that file are inside a Babashka source string.

## One thing I did not do, deliberately

The feature file carries a `# mutation-stamp:` line and an embedded
`acceptance-mutation-manifest` block whose `feature_name` is the OLD title and
whose hashes describe the pre-retirement file. Retiring a scenario makes that
manifest stale by construction.

I did not touch it. The engineering article's guardrail is "no hand-edited
mutation manifests", and correcting one by hand is exactly what it forbids —
the stamp is written by the pinned gherkin-mutator, and a hand-corrected stamp
is indistinguishable from a fabricated one.

**This needs a flag rather than a fix from me**, because BL-1251's
`required_stages` is `[coder, documenter, qa]` — there is no hardener stage in
this parcel to re-run Gherkin mutation. So the stale stamp will reach `main`
unless QA either re-runs the mutator for this file or routes the file to a
hardener pass. Raised here rather than silently corrected or silently left.

## Verification

- `grep` over `specs/features/*.feature` confirms scenario 04's two step texts
  appear in no other feature, so removing their handlers can strand nothing.
- **BL-1248 acceptance after the retirement: 8/8 pass, 0 fail** (461s). It was
  9 scenarios before; scenario 04 is the one that is gone, and the remaining
  eight all still bind to the re-tensed FEATURE constant.
- The acceptance generator picked up the re-tensed pair: it now writes
  `bl-1248-the-master-main-reconcile-sweep-can-be-switched-off-from-config.generated.test.js`,
  and the pre-change generated file (bound to the old title) fails every
  scenario with `no step handler matched` — which is the matched-pair coupling
  the ticket warns about, demonstrated rather than assumed.

### How long this feature takes to run, and why

Four of its five scenarios go through `requireWiringPass`, which shells
`swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh` — a
real git repo, a real bare origin and a real `handoffd` process, with a 180s
per-spawn cap and `wait_for_log` polling inside. The run is memoized per
scenario context, not per file, so a full pass spends minutes rather than
seconds and emits nothing until it finishes.

That is a property of the feature as BL-1248/BL-1256 built it, not of this
parcel: the only executable thing this parcel removed was scenario 04, which
read a file and did not touch the fixture. It is recorded here because a
reviewer who kills the run at the four-minute mark (as I first did) will read
a slow fixture as a hang.

### One benign warning, noted not fixed

The run prints `MaxListenersExceededWarning: 11 exit listeners added to
[process]`. Fifteen-plus step-handler files install one `process.on('exit')`
fixture-sweep listener each (the BL-971 pattern), and the shared registry loads
them all; four of those files are mine and follow the same established shape.
Raising the cap or sharing one sweeper is a repo-wide change to a pattern I did
not introduce, so it is reported rather than made here.
