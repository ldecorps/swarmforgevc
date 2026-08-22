# BL-970 — architect review pass: PASS to hardener (clean sweep, NONE)

- **Ticket**: BL-970 — wake busy-gate misclassifies from whole-pane word
  matching, `type: defect`, `severity: high`, M8, `mutation_cost: low`.
- **Received**: `git_handoff` from cleaner, `3ced65a865` ("Merge coder
  BL-970 (fa060af3e7) for cleanup" — pure passthrough, no cleaner edits of
  its own), task `BL-970-wake-busy-gate-idle-pane-misclassification`.
  Merged clean into `swarmforge-architect`.
- **Reviewer**: architect, 2026-08-20.
- **Verdict**: **PASS to hardener — clean sweep, NONE.**

Trap-resistance note (the ticket's own firm line, honored in this
document too): no verbatim busy-marker strings appear below — fixtures are
named only by filename, patterns described structurally.

## Architecture review — structural frame classification, replacing anywhere-in-pane word matching

Read `chase_sweep_lib.bb`'s diff and traced the new
`live-status-frame-pattern` regex by hand (not from the commit's
description alone):

- The pattern requires, in order: a 1-2 character glyph that is neither
  whitespace/alnum/bracket/quote NOR the two transcript-bullet characters
  Claude Code uses for completed tool calls; then a verb phrase (letters,
  spaces, hyphens, up to 60 chars); then an ellipsis (unicode or
  three-dot ASCII); then an optional space, an open paren, optional space,
  and a digit. This is the live status frame's structural shape, keyed on
  NOTHING lexical (no verb list).
- `actively-processing?` now takes only the snapshot's trailing
  `busy-tail-window` (20) lines and checks whether any line matches — the
  ZONE layer, so a byte-perfect frame line quoted deep in scrollback
  cannot false-busy a pane whose tail shows an idle prompt.
- **Hand-verified against both real production captures** shipped as
  fixtures (not just the runner's own claim): traced the finished-turn
  footer line in the real 4-lingering-shells capture — it has no
  ellipsis+paren-digit shape at all, so it correctly fails to match, unlike
  the old anywhere-in-pane patterns which included a literal match for
  that exact footer's background-shell language. Traced the real mid-turn
  capture with an unlisted verb — its live frame line matches (glyph +
  verb + ellipsis + digit-led parenthetical), AND the same fixture embeds
  a decoy: a tool-preview line containing an ellipsis followed by a
  parenthesized elapsed-time-shaped fragment, indented but with no leading
  glyph — confirmed by hand that the pattern's required glyph-immediately-
  after-optional-whitespace anchor correctly rejects it, so the decoy does
  not double-match or produce a false read.
- The transcript-bullet exclusion (the two Claude-Code completed-tool-call
  markers, excluded from the glyph character class) is necessary and
  exercised directly: a transcript bullet line with an ellipsis+parens
  shape (unit runner's own synthetic case) is correctly classified idle
  specifically because the bullet character can never satisfy the glyph
  class.
- The empty/unreadable-capture contract (empty text → idle) is preserved
  and tested directly (`empty-capture.txt`, and `nil`/`""` synthetic
  cases) — an unreadable pane never blocks a wake, as the ticket requires.
- No call site changed: all four gate predicates (`handoffd.bb`,
  `handoff_inject_lib.bb`, `babysitter_nudge_lib.bb`, `swarm_ensure.bb`)
  funnel through this one function unchanged — confirmed by grepping for
  the function name; the fix is entirely inside the chokepoint.

## Test/fixture co-changes — each verified as a legitimate semantics update, not scope creep

- `babysitter_nudge_lib_test_runner.bb`: the old assertion pinned a bare
  marker fragment (no real frame) as busy — that was pinning the exact
  defect. Correctly inverted to assert it is NOT busy, with a new sibling
  assertion using a real synthetic frame to keep the busy path exercised.
- `test_handoffd_wake_attribution_wiring.sh` and `test_swarm_ensure.sh`:
  both had fixture panes rendering the OLD bare-footer-marker shape for
  their busy/skip code paths; both updated to render an actual
  glyph+verb+ellipsis+digit-paren frame so the busy path they test
  continues to fire under the new classifier. Read both diffs directly;
  minimal, targeted, no other behavior touched.
- None of these are scope creep — each is required for its own suite to
  keep meaning what it claims to mean under the new contract.

## Scope boundary respected

The ticket names four specific gate predicates as its chokepoint; a
structurally similar but INDEPENDENT classifier in
`babysitterd_sweep_lib.bb` (health-sweep machinery, not one of the four
wake-gate predicates) was correctly left untouched and surfaced by note
per the commit message — consistent with the ticket's own scope line and
the chokepoint-conversion lesson about not silently widening a fix into a
sibling copy.

## Dependency-rule gate / co-change

- Dependency-rule gate: only the pre-existing BL-759 `acyclic` cycle
  (telegram-front-desk-bot.js family) — unrelated, no file this parcel
  touches sits under `extension/src` or `extension/media`.
- Co-change: `chase_sweep_lib.bb`'s top co-changer is `handoffd.bb` (its
  primary chokepoint caller) plus its own sibling test runners — all
  expected, long-standing. Nothing new.

## Invariants review (BL-633/654) — both declared, both encoded and non-vacuous

1. **An idle prompt with no live frame is never busy, whatever marker text
   persists**: encoded by `bl970_busy_gate_property_runner.bb`'s
   idle-contaminated draws (idle footer + scrollback deliberately
   contaminated with every known false-busy shape: backgrounded-shell
   chrome, quoted marker phrases inside transcript lines, transcript
   bullets with ellipsis-parens, and a byte-perfect frame line placed
   above the tail window) plus the unit runner's matching synthetic cases
   and three of the seven shipped fixtures.
2. **A live frame is busy regardless of its verb**: encoded by
   busy-random-verb draws using letter strings generated to provably
   exclude the retired hand-maintained verb list, across one/two-word
   verbs, both ellipsis forms, and random glyphs/elapsed content. Both
   real mid-turn fixtures (each carrying a verb the old list never
   contained) exercise this directly.
- Non-vacuity: two documented staged-first breaks — break 1 reverts to
  anywhere-in-pane word matching (RED on the first contaminated-idle
  draw, reproducing the original reported defect exactly); break 2
  replaces the structural pattern with the retired verb list (RED on the
  first random-verb frame, proving the verb-list removal — not just the
  zone/structure change — is load-bearing for invariant 2). Both targeted
  at the two directions the ticket names.
- No violation found on either declared invariant.

## Verified live, not from the parcel's own claims

- `bb swarmforge/scripts/test/actively_processing_test_runner.bb`:
  **ALL CHECKS PASSED** (seven shipped fixtures plus the synthetic edge
  cases, including the transcript-bullet-decoy and above-window-frame
  cases).
- `bb swarmforge/scripts/test/bl970_busy_gate_property_runner.bb` at the
  shipped default (`runs=120`, run detached to clear this session's
  ~2min foreground tool cap): **ALL PROPERTIES HOLD**, coverage
  `{:idle-contaminated 61 :quoted-marker 21 :above-window-frame 11
  :busy-random-verb 59 :busy-two-word 20 :busy-ascii-ellipsis 8}` — every
  reach floor met (idle-contaminated≥10, quoted-marker≥5,
  above-window-frame≥4, busy-random-verb≥10, busy-two-word≥4,
  busy-ascii-ellipsis≥3).
- `node specs/pipeline/cli.js specs/features/BL-970-wake-busy-gate-idle-pane-misclassification.feature`:
  **7/7 pass** (all seven Examples rows of the single Scenario Outline,
  40.4s, also detached).
- Every named sibling regression run live: `test_chase_sweep.sh` **ALL
  PASS**, `test_handoffd_wake_attribution_wiring.sh` **ALL PASS**,
  `test_swarm_ensure.sh` **ALL PASS** including RC-9 specifically
  confirmed exercising the new frame fixture (its own persistently-busy
  regression case) — matches the coder's stated inventory exactly.

## Hardening fallback (per engineering rules)

Babashka has no mutation/CRAP/DRY wired (BL-472 deferred) — this parcel
gates on the unit runner, the property runner, the acceptance suite, and
the consumer regressions above, recorded here as the qa_e2e procedure's
step 5 requires.

## Property-testing pass

No new undeclared-property coverage warranted: the parcel touches no
TypeScript/JS pure module under `extension/src` — only Babashka (`.bb`)
production code, shell test fixtures, and an integration-style acceptance
step handler that deliberately never holds fixture text in a JS string.
The declared invariants are the property surface here and are already
fully covered.

## Everything else

No correctness defects found reading the diff or exercising the code. The
live-swarm sweep and live-wake confirmation (qa_e2e steps 3-4) are
explicitly left to QA per the ticket's own procedure.
