# BL-1419 — hardener pass, 2026-09-05

Ticket: BL-1419-the-briefing-email-reflows-and-reads-well-on-a-phone
Commit reviewed: e837df3028 (architect NONE pass)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/markdown_to_html_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/briefing_email_test_runner.bb` | ALL PASS |
| `node specs/pipeline/cli.js specs/features/BL-1419-...feature` | 8/8 pass |
| `node specs/pipeline/cli.js specs/features/BL-393-briefing-body-html.feature` (regression) | 5/5 pass |
| `node specs/pipeline/cli.js specs/features/BL-896-briefing-not-done-burndown-stamp.feature` (regression) | 7/7 pass |
| `node specs/pipeline/cli.js` on BL-260/BL-579/BL-580 (diagram regressions) | 5/5, 3/3, 2/2 pass |
| `diff docs/briefings/2026-09-05.md specs/pipeline/steps/fixtures/BL-1419-2026-09-05-briefing.md` | identical |
| `npx jscpd` on the 4 touched/new files, correct invocation (positional paths + `--pattern "**/*.{ts,js}"`) | 1 residual clone (9 lines/58 tokens), read directly — the per-file require/path-constant boilerplate, not logic duplication; matches cleaner's/architect's own claim |
| `backlog/standing-reds.tsv` / `property_suite_standing_allowlist.tsv` | neither names this file family |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently rendered the real briefing myself (not just trusted the claimed numbers)

Loaded `markdown_to_html_lib.bb` and `briefing_email_lib.bb` directly and
ran `render-markdown-to-html` + `render-briefing-html` over the real
`docs/briefings/2026-09-05.md`:

```
li count: 24
blockquote count: 1
h2 count: 3
style-block count: 0
```

Exact match to every prior role's claimed counts. Also confirmed
independently: `grep -o '<li[^>]*>' | grep -v 'style='` and the `<p>`
equivalent both return zero matches (every `<li>`/`<p>` carries an inline
style), and `style=` occurs 86 times in the rendered output with 0
`<style` blocks — matching the architect's own figures exactly.

## Independently confirmed invariant 3 by reading the source

Read `compose-and-send-one!` directly
(`swarmforge/scripts/briefing_email_lib.bb:493-512`): `content` (the
plain-text part, built through the pre-existing
optional-sections/diagram-note/token-burn pipeline) is passed to
`:send-email!` completely unmodified; `html` is computed separately via
`render-briefing-html`, fed FROM `content` but never fed back into it —
no shared mutable state between the two paths, confirming invariant 3
holds by construction.

## Independently reproduced non-vacuity myself (not just trusted)

Reverted `swarmforge/scripts/markdown_to_html_lib.bb` to its pre-BL-1419
committed version (`git show a5123374bc^:...`) and re-ran the unit suite:
**6 failures** — paragraph, bold-span, backtick/code, list-with-
continuation, blockquote-joining, and the list-then-paragraph boundary
case all reproduced exactly BL-393's old per-line contract. Restored the
file; confirmed byte-identical via `diff` and `git status --short`
(empty); re-ran the suite — ALL PASS again.

## BL-113 hard gherkin mutation: clean

One `Scenario Outline` (scenario 01, 3 examples × 2 mutable columns = 6
mutants). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js hard` (all 4 positionals
explicit, workdir removed after). Result: **6 mutants, 6 killed, 0
survived** — manifest confirms
`"Total":6,"Killed":6,"Survived":0,"Errors":0"`. Scenarios 02–06 are
plain `Scenario:` blocks, not mutation targets.

## Design/CRAP/DRY

Babashka files carry no mutation/CRAP/DRY tooling (BL-472 deferred,
Engineering Rules) — gated by the unit-test pass/fail plus the clean
BL-113 gherkin-mutation pass above, matching the architect's own
disposition. jscpd (correctly invoked) confirms the one residual clone
is the deliberate, considered stopping point both prior roles identified
— re-confirmed by reading the actual lines (require/path-constant
declarations), not merely re-trusting the tool count.

## Verdict

No defect. Forwarding to documenter.
