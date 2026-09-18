# BL-1633 — hardener spec-gap finding, 2026-09-18 (not a bounce)

## What happened

BL-1633's own diff is correct, complete, and matches its stated scope
(reviewed: `check-suite-file-budget.ts`'s `confirmOffendersAlone`/verdict
extension, `recordTestDuration.js`'s `confirmPoleAlone` including the
`stdio: 'ignore'` fix the coder caught during its own bounce response,
59/59 unit tests, 5/5 acceptance). BL-1620's own feature correctly comes
down to 2/2 (scenarios 01/03) after the BL-1006 retirement of its
scenario 02, per the ticket's own explicit scope.

But BL-1633's land also breaks an UNSCOPED sibling: BL-1598's own feature
(`specs/features/BL-1598-the-unit-suite-pole-register-makes-the-per-file-gate-green.feature`,
already `backlog/done`) has its own scenario 03:

```
Scenario: the committed register names the nine poles of 2026-09-16 with an open owner each
  When backlog/suite-poles.tsv is read
  Then it holds exactly 9 rows
  And every row names a ticket present under backlog/paused or backlog/active
  And bl968StepRegistryMaterializedTreeGuard.test.js and telegramFrontDeskBotCli.test.js are among the files
```

Confirmed: `git show 6e796454f8^:backlog/suite-poles.tsv | grep -v '^#' |
wc -l` → 9; `git show 6e796454f8:...` (BL-1633's own coder commit) → 8 -
BL-1633 removing `telegramFrontDeskBotCli.test.js`'s row (the ticket's
own, intended, correct fix) drops the count from 9 to 8 and removes the
named file from the register entirely. Both assertions in that scenario
now fail (the count check fails first and short-circuits the Gherkin
step sequence, so the file-name check never even runs, but it would also
fail - the file is genuinely gone, confirmed by grep). Live:

```
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1598-*.feature
... 11 pass, 1 fail ...
not ok 12 - the committed register names the nine poles of 2026-09-16 with an open owner each
Scenario ... failed at step "Then it holds exactly 9 rows": Expected values to be strictly equal:
8 !== 9
```

## Why this is a spec-gap, not a bounce

This is the EXACT class BL-1633's own ticket text already names and
handles for BL-1620's scenario 02 (BL-1006: "a durable contract carrying
a false sentence is still a lie" - a snapshot-in-time premise frozen into
a standing scenario goes stale the moment reality moves past it, here by
the register's own designed mechanism: poles get fixed and their rows
removed). BL-1633's own constraints correctly name BL-1620's feature as
in scope for exactly this reason, but do not name BL-1598's - an
oversight, not a decision, since the two scenarios are symmetric: both
assert something true only "as of 2026-09-16" and BL-1633's own intended
effect (retiring one of the nine rows) is precisely what falsifies each
of them.

I am not fixing BL-1598's feature myself: which of several remedies is
right (retire the whole scenario the way BL-1620's was, drop just the
count assertion and keep the ticket-presence check, or reword it to a
dynamic/no-op form) is a Gherkin-authorship decision for the specifier,
the same way BL-1620's scenario 02 retirement was speced by the
specifier rather than silently done by a downstream role. BL-1633's own
authored diff is otherwise complete and I am forwarding it unchanged.

## Recommendation (not binding)

Retire BL-1598's scenario 03 the same way BL-1620's scenario 02 was
retired this same day (BL-1006 shape): delete the scenario and its
"holds exactly 9 rows"/"are among the files" steps if no standing meaning
survives once poles are expected to be retired one at a time, or replace
the fixed count/names with a looser invariant (e.g. "every row names an
open ticket" alone, already covered by the OTHER passing assertion in
that same scenario) if some meaning is worth keeping.

By hardener.
