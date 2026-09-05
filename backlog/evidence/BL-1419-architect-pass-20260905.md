# BL-1419 — architect pass, 2026-09-05

Ticket: BL-1419-the-briefing-email-reflows-and-reads-well-on-a-phone
Role: architect
Commit reviewed: 61bfcf62ab (cleaner NONE pass — DRY fix, no behavior change)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.` The change is Babashka lib code
  (`markdown_to_html_lib.bb`, `briefing_email_lib.bb`), its bb test
  runners, and acceptance step/fixture files — no webview, no VS Code
  API, no secrets, no browser storage.
- **Co-change report**: nothing suspicious beyond this ticket's own family
  and its known regression-touching siblings (`briefingBodyHtmlSteps.js`,
  `bl896BriefingOpenTicketChartSteps.js`).
- **jscpd**, independently re-run on the four touched/new JS files: **1
  residual clone** (9 lines, the per-file wrapper's own
  prefix/filename/harness-path binding) — confirmed this is the correct
  stopping point, not an oversight: inlining the shared calls with each
  file's own literals at every call site would repeat the literal MORE,
  not less (`briefingBodyHtmlSteps.js` alone has 5 call sites).
- **Fixture byte-identity**: `diff docs/briefings/2026-09-05.md
  specs/pipeline/steps/fixtures/BL-1419-2026-09-05-briefing.md` — empty,
  confirmed identical myself.
- **Register check**: neither `backlog/standing-reds.tsv` nor
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` names this
  file family — correctly, this is a fresh feature, not a red-register
  cleanup. Babashka files carry no mutation/CRAP/DRY tooling (BL-472
  deferred, per Engineering Rules) — jscpd above is the applicable check
  for the JS-side step/fixture files; the bb test runners are gated by
  their own unit-test pass/fail only.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"A line break inside a markdown block never survives into the HTML
   part as an element boundary"** — read the new block-partitioning
   predicates (`list-item-line?`, `blockquote-line?`,
   `list-continuation-line?`, `paragraph-continuation-line?`) directly:
   they correctly classify a run of consecutive lines by block type
   before joining, and `render-inline-markdown`'s bold/code regexes run
   AFTER joining (confirmed by reading the call order), so a span
   wrapped across a source line break closes correctly. Independently
   confirmed non-vacuity myself: reverted `markdown_to_html_lib.bb` to
   its pre-BL-1419 committed version, reran the unit suite — **6 failures**,
   reproducing exactly BL-393's old per-line contract on paragraph, bold,
   code, list, blockquote, and the list-then-paragraph boundary cases.
   Restored, confirmed byte-identical via `diff`, reran — all pass again.
2. **"Every style the HTML part depends on is carried inline... complete
   with every `<style>` block removed"** — rendered the REAL
   `docs/briefings/2026-09-05.md` through the real
   `render-markdown-to-html` + `render-briefing-html` pipeline myself
   (not trusting the coder's/cleaner's claimed numbers): **0 `<style>`
   blocks**, **86 inline `style=` attributes**, and confirmed every
   `<li>` and every `<p>` in the output carries an inline `style`
   attribute (`grep -o '<li[^>]*>' | grep -v 'style='` and the `<p>`
   equivalent both return empty). `style-inline-elements` uses a literal
   (non-regex) `str/replace` against bare opening tags, which is exact
   and total because `render-markdown-to-html` only ever emits bare tags
   with no pre-existing attributes (confirmed by reading the renderer) —
   no risk of double-styling or a missed tag shape.
3. **"The plain-text part is byte-identical to the composed markdown"** —
   read `compose-and-send-one!` directly: `content` (the plain-text,
   built through the pre-existing optional-sections/diagram-note/token-burn
   pipeline, unchanged by this ticket) is passed to `:send-email!`
   unmodified; `html` is a SEPARATE value computed from
   `render-briefing-html`, never derived from or fed back into `content`.
   No shared mutable state between the two paths.

## Independently re-verified the substance

- `bb swarmforge/scripts/test/markdown_to_html_test_runner.bb` — **ALL
  PASS**.
- `bb swarmforge/scripts/test/briefing_email_test_runner.bb` — **ALL
  PASS**.
- `node specs/pipeline/cli.js
  specs/features/BL-1419-the-briefing-email-reflows-and-reads-well-on-a-phone.feature`
  — **8/8 pass**.
- `node specs/pipeline/cli.js specs/features/BL-393-briefing-body-html.feature`
  (regression) — **5/5 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-896-briefing-not-done-burndown-stamp.feature`
  (regression) — **7/7 pass**.
- `node specs/pipeline/cli.js` on `BL-260`, `BL-579`, `BL-580` (diagram
  regressions) — **5/5, 3/3, 2/2 pass**, all matching the evidence exactly.
- Real briefing render: **24 `<li>`, 1 `<blockquote>`, 3 `<h2>`, 0
  `<style>` blocks, 0 ragged dash-led `<p>` fragments** — exact match to
  both the coder's and cleaner's claimed counts, reproduced independently.

## required_wiring

- `swarmforge/scripts/briefing_email_lib.bb::render-briefing-html` —
  confirmed present; `compose-and-send-one!` calls it directly (read the
  source, line 509).
- `specs/pipeline/steps/bl1419BriefingEmailReflowSteps.js::registerSteps` —
  present, discovered by directory scan (BL-1371), confirmed by the
  acceptance run passing 8/8.

## Regression-fix scope judgment

Agree with the coder's and cleaner's shared judgment on the three
pre-existing tests updated to tolerate the new inline `style` attribute
(`briefing_email_test_runner.bb`, `briefingBodyHtmlSteps.js`,
`bl896BriefingOpenTicketChartSteps.js`): each change is `<tag>` →
`<tag[^>]*>`, which cannot cross a `>` boundary and still anchors the
specific tag name and content — a structural loosening to tolerate a
direction this ticket owns (style values), not a weakened assertion.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. Forwarding to hardener.
