# BL-1716 — spec-gap: qa_e2e_procedure's shell-test bar is not fully
reachable within this ticket's own declared Scope, 2026-09-24

## What I found

BL-1716's qa_e2e_procedure step 2 requires
`swarmforge/scripts/test/test_bl1366_land_is_one_command.sh` to run with
"no FAIL line" on the parcel commit. With this ticket's `replay!` fix
applied (scratch/branch leftover recovery, keyed on an owner
{pid,start-ms} record), the test's own cited symptom is gone: case 5's
second `run_land` call no longer hits `worktree add -b`'s branch
collision, and the misleading "could not create worktree ... off
origin/main" (no git stderr) never appears again. Two FAIL lines remain,
both **outside** this ticket's declared Scope (`land_step_lib.bb`'s
`replay!` only; "Not in scope: land-plan and land_step_cli.bb"):

1. **Case 1** (`the approved commit reached origin/main`): fails because
   `origin_main()` now differs from the raw approved `$SHA` - land-step
   replays every land into a NEW tip-pure commit (BL-1241, already
   shipped) rather than pushing the cited SHA verbatim, so this
   assertion's premise predates that design. Confirmed **pre-existing and
   unrelated to this ticket**: identical with this ticket's WHOLE diff
   stashed out (`git stash push -u -- <the 3 changed/new files>`, re-run,
   `git stash apply <sha>` to restore - a genuinely clean round-trip).

2. **Case 5**'s own second check (`and a subsequent land succeeds`):
   once the branch-collision bug is fixed, this second `run_land` call
   builds a FRESH replay scratch successfully, then finds its own-paths
   already byte-identical to origin/main - because land-1's OWN kill
   attempt, empirically, **always fully completes first**. I confirmed
   why directly: bash defers a trapped signal (TERM here) until the
   currently-running foreground command finishes; a command substitution
   `$(bb ...)` is exactly such a foreground command, so `kill -TERM
   $LAND_PID` sent 2s after launch does not touch the `bb
   land_step_cli.bb` child at all - it fully finishes, prints
   `LAND_PUBLISHED <replayed-sha>`, and only THEN does the wrapping
   script's own trap fire and release the lock. (Isolated proof: a
   `bb -e '(Thread/sleep 4000) ...'` inside `$(...)`, SIGTERM'd to the
   wrapping script after 1s, still prints its own completion line - the
   child is untouched.) With land-1 already fully landed, land-2's
   "nothing to commit" is `replay!`'s own correct, pre-existing (BL-1474)
   answer for a REPEAT land of an already-landed ticket+commit -
   `land_main_publish.sh` then wraps it as "entangled tip ... specifier
   adjudication needed", which reads as a defect but is a SEPARATE
   decision belonging to `land-plan`/`land_step_cli.bb` (BL-1713's own
   territory): should landing the exact same ticket+commit a second time
   report a benign no-op success instead of an escalation? That question
   is unaddressed by BL-1716's own text and is squarely out of the
   `replay!`-only Scope this ticket was minted with.

## What this means for BL-1716 itself

This ticket's own three Gherkin scenarios (dead leftover cleared and
rebuilt; live leftover left untouched, naming the owner; a create failure
carrying git's own error text) and its one declared invariant all pass
cleanly and repeatably in isolation - the FIX itself is complete and
correct for everything the ticket's own text asks of `replay!`. The
qa_e2e_procedure's literal "no FAIL line" bar for the shell test cannot be
met without ALSO touching `land-plan`/`land_step_cli.bb`, which this
ticket explicitly excludes.

## Ask

Either: (a) amend qa_e2e_procedure step 2 to check for the ABSENCE of the
ticket's own cited symptom (the worktree-collision FAIL line) rather than
a bare "no FAIL line" on the whole suite, and mint a follow-up for
land-plan's repeat-land handling (case 5's "nothing to commit" ->
escalation) plus case 1's own stale SHA-equality assertion; or (b) widen
this ticket's Scope to include that land-plan decision. I have not acted
on either without adjudication (Article 4.4: a spec gap leaves by note,
never a parcel) - continuing to forward BL-1716's own `replay!` fix as-is
in the meantime, since it is complete and independently correct.

By coder.
