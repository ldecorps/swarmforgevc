# BL-1315 — specifier stage verification (expedited run, 2026-08-31)

Expedited run `swarmforge/scripts/expedite.sh BL-1315`, stage 1/7. The ticket
needed no amendment: every claim in its description was re-verified live
against `origin/main` (== `main` == this branch's base, `dcd91c1d7c`) before
the coder starts. Recorded here rather than in the ticket YAML so the parcel
carries the evidence without a rename/modify conflict against the expeditor's
still-uncommitted `paused/ -> active/` move in the master checkout.

## Both faces of the defect reproduce, exactly as described

Read-only, via `land-step-lib/own-paths` (no `replay!`, so no branch created):

- **Over-include.** `own-paths "." "86c2ed1c2d" "BL-1298"` returns **34**
  paths, five of them attributable to the unlanded BL-1303:
  `extension/src/tools/check-feature-handler-registration.ts`,
  `extension/test/bl1303FeatureHandlerRegistration.property.test.js`,
  `specs/pipeline/steps/bl1303FeatureHandlerRegistrationSteps.js`,
  `swarmforge/scripts/check_feature_handler_registration.sh`,
  `swarmforge/scripts/test/test_check_feature_handler_registration.sh`.
- **Under-include.** `own-paths "." "ab8d10a8b3" "BL-1303"` returns **20**
  paths — the count the ticket states — carrying
  `check_feature_handler_registration.sh` but NOT the
  `check-feature-handler-registration.ts` it shells out to, and not the
  `bl1303…Steps.js` handler. Landing that tip wires a guard whose `$CHECKER`
  has no source, exactly as the ticket says.

None of BL-1303's three artefacts is on `origin/main`, so the entanglement is
still live and the ticket is not history.

## Named code all still exists, at the cited places

`land_step_lib.bb:205` `own-paths`; `task_scope_gate_lib.bb:386`
`task-tagged-changed-paths`. The direction's three helpers are real and
private to `land_step_lib.bb`: `ancestry-commits` (:71), `blob-at` (:96),
`commit-ticket-id` (:56); `landed-siblings` (:150) already answers scenario
02's "byte-identical to what origin/main holds" via its `same-content?` blob
comparison (:163).

## Gates run at this stage

| Gate | Result |
|---|---|
| `gherkin_lint_gate.sh` | PASS — parses cleanly |
| APS `gherkin-parser` + `gherkin-ir-dry-checker` | 27 step occurrences, 20 unique, 3 medium findings — all three are the pairs the ticket's `notes:` already adjudicated (outline placeholder vs literal, `"coder"`/`"hardender"` as one parameterised step, one false synonym against a Background step). No registry duplication. |
| `specifier_backlog_hygiene_gate.sh` | PASS (`ok`) |
| `pre-qa-gate-lib/read-required-wiring` | `:present? true`, `:items` **2** — not `nil`, so the field is not silently void |
| step-pattern collision sweep | none — no existing handler matches any BL-1315 step |
| `node specs/pipeline/cli.js <feature>` | 7 scenarios, 7 fail with "no step handler matched" — the expected pre-coder state; the handler is the coder's to land in this parcel (BL-233) |

`required_wiring` anchors parse to `land_step_cli.bb::land-step-lib/replay!`
(verified PRESENT, `land_step_cli.bb:65`) and
`specs/pipeline/steps/index.js::bl1315` (verified ABSENT — the coder's to
add). The expedite path skips the pre-QA wiring gate (BL-1255), so both were
checked by hand here and must be re-checked by hand before QA.

## Freshness gate (Article 3.6): confirm-promote

No supersede marker for BL-1315; `depends_on: [BL-1308]` is landed and closed
(`backlog/done/M8/`, `a9ff7a3d00` and `f3166a3fd5` both ancestors of
`origin/main`); no spec-gap bounce recorded against BL-1315.

## Surfaced, not fixed — out of scope for this parcel

1. **BL-1272's implementation is on `origin/main` while its ticket sits
   `status: blocked` in `backlog/paused/`.** `ec0584131b`, the feature file
   and `bl1272LandedSiblingSteps.js` are all present on `origin/main`, and
   `index.js` registers the handler. It appears to have landed as a passenger.
   This is coordinator bookkeeping, and it also discharges BL-1315's own
   orthogonality warning ("do NOT promote concurrently with BL-1272, same
   file") — there is no longer concurrent work in `land_step_lib.bb`.
2. **The expeditor's park moves are staged but uncommitted in the master
   checkout** (`BL-1315` paused->active, `BL-1303`/`BL-1316` active->hold).
   Known gap, already ticketed as BL-1034. Left alone: the master checkout
   also holds unrelated third-party WIP (front-desk bot edits, two untracked
   `providerChatSeat*.ts`), and nothing there is mine to sweep.
3. **`specs/features/BL-1315-*.feature` is on `origin/main` with no
   registered handler.** House-normal rather than a new breach — the
   acceptance runner is invoked per feature file, there is no aggregate
   sweep, and a scan finds ~280 of 1003 feature files in the same state. This
   parcel closes its own case in the coder stage.

By specifier.
