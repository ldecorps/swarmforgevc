# BL-896 — QA bounce — 2026-08-17

## Complete review inventory (Article 4.4 — one bounce, everything run)

- Compile: `npx tsc --noEmit -p extension` — clean, no errors.
- Unit: `npx vitest run test/notDoneBurndown.test.js test/gitHistoryAdapter.test.js
  test/renderBriefingBurndownCli.test.js test/deliveryMetrics.test.js` —
  independently re-run, 67/67 PASS (matches architect's evidence).
- Properties: `npm run test:properties -- test/bl896BriefingOpenCountInvariants.property.test.js`
  — 2/2 PASS. `bb swarmforge/scripts/test/bl896_briefing_diagram_source_independence_property_runner.bb`
  — 500 runs, ALL PASS.
- `bb swarmforge/scripts/test/briefing_email_test_runner.bb` — ALL PASS.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-896-briefing-not-done-burndown-stamp.feature` — 7/7 PASS.
- F2 (dedup): `isRemainingOnDay` no longer defined in `notDoneBurndown.ts`;
  `deliveryMetrics.ts` calls the single `gitHistoryAdapter.ts::isTicketRemainingAtDayEnd`.
  Confirmed resolved.
- F3 (reconciliation) and F4 (fail-open independence): behavior matches
  architect's evidence file, independently re-run above.
- required_wiring (`handoffd.bb::briefing-burndown-json`): present at
  `swarmforge/scripts/handoffd.bb:2219`. PASS.
- No orphaned test/mutation processes before or after (`pgrep -fl 'node
  --test|stryker|vitest'` empty both times).

All of the above: PASS. One item fails.

## D1 (behavior defect, coder-owned) — the heading contradicts the ticket's own recorded human ruling

1. **Failing command:**
   `grep -n 'Open tickets remaining' extension/src/metrics/notDoneBurndownChart.ts swarmforge/scripts/briefing_email_lib.bb`
   — matches (heading reads "Open tickets remaining", never "burndown").
2. **Commit hash:** `7178272c4f` (documenter's forward; the naming choice
   itself originates at coder's `046d95fc1`, unchanged since).
3. **First error excerpt** (the contradiction, not a stack trace):
   - Ticket's own `notes:` (`backlog/active/BL-896-swarm-stamp-briefing-open-ticket-chart.yaml:184-189`),
     HUMAN RULING 2026-08-16 ~08:20 CEST: *"Keep the word 'burndown' on the
     heading (overrides the specifier's F1 rename recommendation)."*
   - Durable copy, `backlog/answers-archive/ANSWER-BL-896-land-burndown-chart.md`,
     committed `5dfaeb56e` **"By coder"** at **08:28:39**: *"Keep the word
     'burndown' on the heading."*
   - Coder's own certify commit `046d95fc1`, **08:29:41** (62 seconds
     later, same session) still renames the heading away from "burndown":
     `extension/src/metrics/notDoneBurndownChart.ts:96` → `"Open tickets
     remaining — last ${data.windowDays} days"`; `briefing_email_lib.bb:195`
     maps `"not-done-burndown" -> "Open tickets remaining"`, with a comment
     citing the now-superseded F1 rename rationale.
   - The feature file itself was authored to the pre-ruling requirement:
     `specs/features/BL-896-briefing-not-done-burndown-stamp.feature`'s
     mutation-stamp `tested_at` is `2026-08-16T07:48:45Z`, before the
     08:20 ruling — scenario 01 asserts *"its heading names the series as
     remaining open tickets over the window"*, i.e. it encodes the
     rename, not the override. This is why the acceptance run above is
     green: the gate itself tests the wrong requirement.
   - Architect's own pass (`backlog/evidence/BL-896-swarm-stamp-briefing-open-ticket-chart-architect-pass-20260816.md`)
     explicitly verified the rename as F1 "fixed" ("None read 'burndown'"),
     and documenter's how-to
     (`docs/how-to/BL-896-briefing-open-ticket-chart.md:12`) states
     *"The heading says 'Open tickets remaining,' never 'burndown.'"* as a
     documented fact — neither stage cross-checked the ticket's own notes
     against what they were certifying.
4. **Failure class:** `behavior` (the code does the opposite of the
   ticket's own current, controlling requirement — not a compile, unit, or
   acceptance failure, since the acceptance gate itself was authored
   against the stale requirement).
5. **Expected vs observed:** Expected — the live briefing heading, SVG
   title, and note-line keep the word "burndown" per the human's
   2026-08-16 08:20 CEST ruling, which explicitly overrides the F1
   rename. Observed — all three surfaces read "Open tickets remaining",
   the exact rename the ruling overrode.

## Remediation (coder)

- Revert the F1 rename: restore "burndown" to the heading/SVG
  title/note-line per the human ruling (exact wording is the coder's call
  within that constraint — the ruling only pins the word "burndown", not a
  full sentence).
- Update `specs/features/BL-896-briefing-not-done-burndown-stamp.feature`
  scenario 01 (and its step handler) to assert the ruling's actual
  requirement instead of the superseded F1 rename, so the acceptance gate
  stops passing a heading it should reject.
- Update `docs/how-to/BL-896-briefing-open-ticket-chart.md`'s claim
  ("The heading says 'Open tickets remaining,' never 'burndown.'") to
  match — this is downstream of the coder's fix, not a separate documenter
  defect (Article 4.3: routes to `coder` when code and docs are both
  wrong, the earlier of the two).
- Re-run the JVM... n/a (TS/Babashka only here); re-run the unit,
  property, and acceptance suites listed above after the fix.

By QA.
