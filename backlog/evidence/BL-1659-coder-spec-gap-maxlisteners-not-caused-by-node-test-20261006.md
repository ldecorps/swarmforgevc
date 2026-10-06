# BL-1659 coder spec-gap: the MaxListenersExceededWarning is not caused by node:test

## What the ticket claims

`description` "What is wanted": `node -e "require('./specs/pipeline/steps/index.js')"`
prints no TAP line and no MaxListenersExceededWarning, once every handler
drops its `node:test` require. Scenario 03's own Then step makes the same
combined claim: "the child's output carries no TAP version line and no
MaxListenersExceededWarning".

## What is actually true on main, measured both before and after this parcel

Before (HEAD, with all 75 handlers still requiring `node:test` at module
load):

```
$ node -e "require('./specs/pipeline/steps/index.js')" 2>&1 | grep -n 'TAP version\|MaxListeners'
1:(node:23637) MaxListenersExceededWarning: ... 11 exit listeners added to [process] ...
3:TAP version 13
```

After this parcel (every handler's `node:test` require dropped, census
confirms `registeredTestRunner: false` for all 1404 handlers, zero
require errors):

```
$ node -e "require('./specs/pipeline/steps/index.js')" 2>&1 | grep -n 'TAP version\|MaxListeners'
1:(node:11273) MaxListenersExceededWarning: ... 11 exit listeners added to [process] ...
```

The TAP epilogue is gone (node:test is no longer required by anything in
the tree, confirmed by census). The MaxListenersExceededWarning is
UNCHANGED - same count (11) before and after. It was never caused by
node:test's own exit-listener registration; it comes from the 56 handler
files (and `lib/fixtureReaper.js`, `lib/socketFixtureRoot.js`) that
register `process.on('exit', ...)` / `process.once('exit', ...)` for their
OWN legitimate cleanup, unrelated to this ticket. This parcel's own
`out_of_scope` section already names this class: "Handlers that use
`process.once('exit', ...)` for their own cleanup without node:test: the
coder's evidence names them as legitimate; they are left as they are."

## Consequence

Scenario 03 ("requiring the step registry in a fresh child prints no
test-runner epilogue") cannot pass as literally written: its Then step
asserts BOTH conditions, and the second one is a pre-existing, out-of-scope
fact this ticket does not touch. 3 of 4 scenarios pass; scenario 03 fails
on the MaxListeners half of its assertion only (the TAP half passes).

## What I did NOT do

I did not weaken or edit the committed feature file
(`specs/features/BL-1659-...feature`) to drop the MaxListeners clause -
amending an in-flight ticket's spec is the specifier's call (Article
workflow, "Amending An In-Flight Ticket's Spec"), not mine. I did not
expand this ticket's scope to touch the 56 unrelated exit-hook files, which
the ticket's own `out_of_scope` section already excludes. I did not raise
`process.setMaxListeners()` globally as a silent side effect, since that
would mask a real (if harmless at today's count) signal for a future
regression.

## Recommendation

Either (a) amend scenario 03's Then step to assert only "no TAP version
line" (the claim this ticket actually makes true), moving the
MaxListenersExceededWarning claim to a new ticket scoped at the 56
exit-hook files (e.g. a shared registration guard, or
`process.setMaxListeners()` at the registry's own entry point), or (b)
confirm the combined claim was always aspirational and split it now.

commit: forwarded with the node:test removal, the production guard
(`checkHandlerBudgets` now flags `registeredTestRunner`), and this
scenario left failing-as-specified (never silently weakened) so the gap is
visible, not hidden, in the QA evidence.
