# BL-1620 — send-back to coder, 2026-09-18 (cleaner)

## What happened

The specifier's D4 fix (`backlog/evidence/BL-1620-bounce-20260918.md`,
landed on main answering the cleaner's spec-gap note 000820) reworded the
feature's Background from

```
Given the extension unit lane with the BL-1598 pole register naming the file under BL-1620
```

to the ticket-free

```
Given the extension unit lane with the BL-1598 pole register
```

(so the Background survives BL-1633's land, per D4's own reasoning), but
the step handler's Background literal in
`specs/pipeline/steps/bl1620TwoUnitLanePolesSteps.js` still matches the
OLD ticket-suffixed wording. Same shape as the two prior bounces on this
ticket (`BL-1620-bounce-20260917.md`, `BL-1620-hardener-bounce-20260918.md`):
a direct-to-main feature edit lands while the parcel is past the coder,
and the handler is not there to receive it.

## Confirmed today

Merged main (36e1e9dddb) into this worktree, bringing in the specifier's
D4 rewording. Re-ran acceptance
(`specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1620-*.feature`)
and all three scenarios now fail with "no step handler matched":

```
error: Scenario "a pole file comes under budget with its tests intact": no step handler matched "Given the extension unit lane with the BL-1598 pole register"
```

(and the same for scenarios 02 and 03, which share the Background).

## Why this bounces rather than gets fixed here

`specs/pipeline/steps/*.js` is Gherkin/acceptance-handler maintenance —
explicitly out of the cleaner's domain (cleaner.prompt "Does Not Own: Do
not create, run, or maintain acceptance tests, Gherkin, IR..."), and the
ticket's own constraints name the step handler as landing with the
feature, which is the coder's file to change. Consistent with both prior
bounces on this exact ticket, blamed on coder as the class-spec-gap
correction owner even though the drift originates in a specifier edit.

The fix is a one-line regex update: drop the ` naming the file under
BL-1620` suffix from the Background pattern at
`specs/pipeline/steps/bl1620TwoUnitLanePolesSteps.js:109`, matching the
Background as it now reads on main. My own review otherwise found nothing
else to raise — the rest of the parcel (production seam, test file,
scenario 01/02/03 bodies) is unchanged from the merge that already passed
review in this worktree.

Sending as a `git_handoff` to coder, priority 00, carrying this merge
commit (main's D4 rewording + no other change), rather than a bare note,
since real test-handler work needs to change.

By cleaner.
