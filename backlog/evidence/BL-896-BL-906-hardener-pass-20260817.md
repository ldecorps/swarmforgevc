# BL-896 / BL-906 — hardener pass (batch of 3), 2026-08-17

## Scope

Batch of 3 items received via `ready_for_next.sh`, all merged into this
worktree with plain `git merge --no-ff` (no `reset --hard`, no
`checkout -- .`):

1. BL-896, `merge_and_process architect 914f18e55f` — architect's clean
   review of the round-2 bounce fix (positive acceptance assertion that the
   heading keeps the word "burndown").
2. BL-906, `merge_and_process architect 3e0ab3a79b` — architect's clean
   review of the round-1 bounce fix (new pure predicate
   `should-unlink-pidfile?` + property-test coverage for invariant 2).
3. QA merge-up `note` for BL-902 (`603b75230`, docs-only evidence commits) —
   merged per the QA-merge-up-broadcast rule; chain ends at QA, not
   forwarded.

This round's actual delta (`git diff <prior-hardener-HEAD>...HEAD`) touches
no `extension/src/*.ts` file — CRAP is out of scope this round (CRAP scopes
to `src/*.ts` only) and there is no compiled-output delta for Stryker to
mutate. The only new logic is a pure Babashka predicate (`.bb`, no
mutation/CRAP/DRY tool wired) and a Gherkin step-handler assertion (no
`Scenario Outline:`/`Examples:` touched, so BL-113 Gherkin mutation has
nothing new to run — the existing Outline scenarios in both feature files
are unchanged this round, confirmed by diff).

## Complete review inventory (Article 4.4 — one pass, everything run)

- Orphaned processes before starting: `pgrep -fl 'node --test|stryker'` —
  clean. `uptime` load average 3.67/5.05/8.82 on 4 cores — within range for
  the targeted suites run below (no full Stryker run needed anyway, since no
  `src/*.ts` changed).
- BL-906 property runner (independently re-run):
  `bb swarmforge/scripts/test/babysitterd_freshness_lib_property_runner.bb`
  — clean pass (2000 assertions, P1/P2/P3 including the new
  `should-unlink-pidfile?` predicate).
- BL-906 example-based runner (independently re-run):
  `bb swarmforge/scripts/test/babysitterd_freshness_lib_test_runner.bb` —
  clean pass.
- BL-906 lifecycle/watchdog shell suites (independently re-run):
  `test_babysitterd_lifecycle.sh` — 8/8 PASS (including scenario 04, the
  EXIT-trap ownership check that is the shell twin of the new pure
  predicate); `test_operator_runtime_babysitterd_watchdog.sh` — 20/20 PASS.
- BL-906 acceptance (independently re-run):
  `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-906-operator-babysitterd-freshness-watchdog.feature` —
  10/10 PASS.
- BL-896 acceptance (independently re-run):
  `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-896-briefing-not-done-burndown-stamp.feature` — 7/7
  PASS, including the new "its heading keeps the word \"burndown\"" step.
- BL-896 unit suite (independently re-run):
  `npx vitest run test/notDoneBurndown.test.js test/gitHistoryAdapter.test.js
  test/renderBriefingBurndownCli.test.js test/deliveryMetrics.test.js` —
  67/67 PASS.
- BL-896 properties (kept separate from unit/coverage, per policy):
  `npm run test:properties -- test/bl896BriefingOpenCountInvariants.property.test.js`
  — 2/2 PASS.
  `bb swarmforge/scripts/test/bl896_briefing_diagram_source_independence_property_runner.bb`
  — 500 runs, ALL PASS.
- `bb swarmforge/scripts/test/briefing_email_test_runner.bb` — ALL PASS.
- Hand-inspection of `should-unlink-pidfile?`'s own coverage (BL-638-style
  surgical review, since no Stryker applies to `.bb`): the property runner
  already exercises matching-with-whitespace (4 padding shapes), a
  different pid, blank, and nil, plus two fixed cases pinning the exact live
  regression (racing-launch overwrite must not be unlinked; a real
  `echo $$`-shaped file must be). No gap found beyond what the architect's
  own break-then-fix (removing `str/trim`, confirming >100 failures,
  restoring) already demonstrated non-vacuous. Nothing to add.
- BL-896's step-handler addition (`bl896BriefingOpenTicketChartSteps.js`)
  adds one positive assertion to a plain `Scenario:`, not the file's
  `Scenario Outline:` — re-confirmed via
  `git diff a54753d9d..3e0ab3a79b -- specs/features/*.feature` and
  `git diff 8ba6fc68b..914f18e55f --stat -- 'specs/features/*.feature'`
  that neither ticket's Outline/Examples block changed this round, so
  BL-113 Gherkin mutation has nothing new to mutate.
- CRAP: N/A this round — `git diff <prior-hardener-HEAD>...HEAD --name-only`
  shows no `extension/src/*.ts` file in this round's delta.
- DRY (`npm run dry`, scoped to `extension/src`): N/A this round for the
  same reason — no `src/*.ts` changed.
- Stryker mutation: N/A this round — no compiled-output delta to mutate.
- BL-906's own `qa_e2e_procedure` item 7 ("DEGRADED-GATE RECORD"): recorded
  explicitly here — Babashka/`.bb` has no mutation/CRAP/DRY tool wired
  (engineering.prompt Startup Tools); the shell (`test_babysitterd_lifecycle.sh`,
  `test_operator_runtime_babysitterd_watchdog.sh`) and bb
  (`babysitterd_freshness_lib_property_runner.bb`,
  `babysitterd_freshness_lib_test_runner.bb`) suites above were the whole
  gate for the new predicate, not a mutation/CRAP/DRY run.
- Orphaned processes / leaked fixture tmux servers after all runs: `pgrep
  -fl 'node --test|stryker'` clean; `pgrep -afl tmux` shows only the live
  swarm's own three sockets under `.swarmforge/tmux/` — no fixture leak
  (checked by socket path, not session name, per the BL-807/BL-817 lesson).

## BL-902 merge-up

Merged QA's approved commit (`603b75230`) into this worktree per the
QA-merge-up-broadcast rule. The commit is documenter/QA evidence files only
(no code); nothing for the hardener to harden. Not forwarded — the chain
ends at QA for a merge-up note.

## Verdict

Both BL-896 and BL-906 are clean: prior architect passes already closed
every substantive finding (F1-F4 for BL-896; the three declared invariants
for BL-906), this round's deltas are narrow bounce-fix confirmations with no
new production TS/JS to mutate and a pure Babashka predicate already
non-vacuously covered. No new defects found. Forwarding both to documenter,
each under its own task name (Article 2.6 — multi-ticket batch, one
`git_handoff` per ticket, same commit).

By hardener.
