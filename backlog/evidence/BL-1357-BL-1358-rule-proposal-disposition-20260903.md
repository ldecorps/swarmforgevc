# Rule proposal disposition — REJECTED as scoped, minted as mechanism (2026-09-03, specifier)

**Proposal** (`type: rule_proposal`, `scope: role:hardener`, from hardender,
2026-09-03T04:30:07Z):

> **body:** runtime.js's step-match failure throws before handler() runs, so no
> try/catch reacts. A Background opening a real poll-loop leaks forever on a
> mutated Outline cell. mutationWorker.js has no timeout.
>
> **rationale:** BL-1351's Background opened a real bridge (20ms poll over 1223
> items); a mutated trigger leaked it, pinning the thread 808s, no ceiling. Keep
> expensive/polling acquisition lazy, never in Background.

**Decision: the analysis is accepted in full and the proposed rule is rejected.**
Minted instead as **BL-1357** and **BL-1358**. This is a rejection of the
*instrument*, not of the finding — which is correct, specific, and was verified
independently below rather than taken on trust.

## Every claim checks out

| Claim | Verified |
|---|---|
| step-match failure throws before `handler()` | `runtime.js:24` throws `no step handler matched`; `resolved.handler` is called on line 27, inside the `try` on 26–31. The throw is **outside** it. |
| no try/catch reacts | Confirmed, and it is stronger than stated: `runScenario` has no `finally` either, and `grep -n 'cleanup\|teardown\|finally'` over `runtime.js` and `cli.js` returns **nothing**. |
| a Background-acquired resource leaks | BL-1351's Background ends `And a client connected to /events`. Nothing in the runner reclaims `context`. |
| `mutationWorker.js` has no timeout | `grep -rn 'timeout\|terminate\|deadline\|AbortController'` over `mutationWorker.js` and `gherkinMutation*.js` → one hit, an unrelated `'unterminated acceptance-mutation-manifest block'` error string. |

One thing the report did not say, found while checking: step files that hold real
resources **already** hand-roll cleanup — `bl1305FixtureAgentBinarySteps.js`
defines `teardown(ctx)` at line 103 and calls it at 162, 225, 281, 294. Those
calls are *steps*. They run only if the walk reaches them, which is precisely
what an abort prevents. So the existing convention cannot help here, and there is
no runtime seam for it to hook into.

## Why the proposed rule is the wrong instrument

**1. It is filed at the role that catches this, not the roles that author it.**
The Background's step text is written by the **specifier**; the acquisition
inside the handler is the **coder**'s. A rule in `hardender.prompt` reaches
neither. (Same structural objection as the 2026-09-03 socket-fixture proposal —
see `BL-1290-rule-proposal-disposition-20260903.md`. Two in one session is worth
noticing: the hardener is finding real defects and reaching for prompt prose as
the remedy each time.)

**2. It would permanently narrow Background to route around a fixable defect.**
"Never acquire anything expensive in a Background" fights what Background is
*for* — shared setup. With a teardown seam, acquiring in Background is fine
again. Encoding the workaround as doctrine would outlive the defect and cost
every future author, forever, to avoid fixing 34 lines of runner once.

**3. It leaves the 808 seconds unexplained.** Even a perfectly-followed authoring
rule does not bound a hang from any *other* cause. The missing ceiling is a
separate hole and the report's own body names it.

## Minted

- **BL-1357** — `runScenario` disposes what a scenario acquired, on every exit
  path including the no-handler-match throw. The root fix. `priority: 29`.
- **BL-1358** — a per-mutant time ceiling: a mutant that will not finish is
  killed and reported, never left to pin a worker. The safety net, and the
  higher priority of the pair (`26`) because it bounds *every* future hang,
  including ones BL-1357 cannot prevent, and is the cheaper of the two.

**Split 1:2 under BL-680 consolidation authority.** Two independent missing
mechanisms in different files, each valuable without the other; bundling them
would fail INVEST's Independent and Small. `depends_on` is empty on both,
deliberately.

Both carry `human_approval: pending` (new feature files). BL-1358 additionally
declares `ruling_options`: whether a timed-out mutant fails the gate like a
surviving mutant, or is reported as its own non-blocking category. That is a
genuine fork about who carries the risk, so it is asked rather than chosen.
BL-1357 poses no fork and declares none.

## Checked for duplication — none found

`grep -rln 'mutationWorker\|runScenario\|no step handler matched\|mutation.*timeout'`
across `backlog/paused/`, `backlog/active/` and `backlog/hold/` returns two
files, both false positives on unrelated prose (BL-1331, BL-824). Neither gap
was ticketed anywhere. BL-1349 owns the property lane's *wall clock* — a run that
takes a while, not one that never ends — and is not this.
