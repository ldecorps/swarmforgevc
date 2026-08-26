# BL-576 — architect review (2026-07-23)

Reviewed commit: `863f15b586` (cleaner) — implementation is `699c26d987`.
Verdict: **PASS on architecture — forwarded to hardener.**

## Why it passes

1. **Pure/impure split is exemplary.** All four new `mono_router_lib.bb`
   functions are pure with everything injected: `note-aged?` takes `now-ms`
   and `threshold-ms` (no `System/currentTimeMillis`),
   `parse-note-actionable-after-ms` takes conf *text* (no path, no slurp),
   `suppress-dormant-note-delivery-wake?` takes a *resolved* `chase-action`
   (no tmux probe). `handoffd.bb` is the IO shell that reads the clock,
   slurps the effective conf, probes tmux, and feeds the predicates.
   Dependency direction is inward — adapters depend on policy, never the
   reverse. Satisfies engineering.prompt's "high-level policy stays
   independent of IO/UI/framework/filesystem details".

2. **Reuse over a second source of truth.**
   `suppress-dormant-note-delivery-wake?` composes the *existing*
   `dormant-mailbox-chase-action` rather than inventing a parallel notion of
   "dormant". Because that function's first two cond branches return
   `:wake-own-session` for any role with its own pane and for the
   no-resident degrade path, the suppression is *structurally* incapable of
   changing full-pack behavior. The ticket's "full-pack / standing-session
   roles are untouched" requirement holds by construction, not by a
   separate guard that could drift.

3. **The hoist choice improves on the spec.** The spec suggested hoisting
   `handoff-header-field` above `maybe-notify!`. The coder instead hoisted
   `chase-poke-action` and passes `parcel-type` from the delivery site,
   where headers are *already* parsed — one parse, no extra file read. The
   `(= "note" parcel-type)` guard in the cond short-circuits before the
   tmux probes, so `git_handoff` deliveries pay nothing.

4. **Conf parsing follows the established convention.**
   `parse-note-actionable-after-ms` is a structural clone of BL-216's
   `backlog-depth-lib/parse-max-depth` (same
   split-lines → starts-with? → re-find `#"-?\d+"` → parse-long shape), and
   resolution goes through `backlog-depth-lib/conf-file-path` per
   BL-216/BL-313. The shipped conf line is commented, so
   `starts-with? "config note_actionable_after_ms"` correctly cannot pick
   it up — no drift between the doc line and the tracked default.

5. Two-layer boundary, extension-host-owns-IO, webview storage, and secrets
   rules are untouched by this parcel (daemon-side only) and the full-repo
   gate scan confirms no new violations.

## Gates run

| Gate | Result |
|---|---|
| `dependency-gate.js` (full-repo scan — required hard gate) | **PASS**, no forbidden edges |
| `mono_router_lib_test_runner.bb` | **PASS** |
| `specs/features/BL-576-aged-note-actionability.feature` | **PASS** 24/24 |
| `test_handoffd_chase_sweep_wiring.sh` | **PASS** |
| `test_handoffd_per_recipient_delivery.sh` | **PASS** |
| `test_mailbox_only_delivery.sh` | **PASS** |

The three passing shell wiring tests spawn the real daemon, so they also
prove `handoffd.bb` still loads after the `chase-poke-action` hoist and that
the new `maybe-notify!` cond branch executes in the live delivery path.

`co-change-report.js` on the changed files: the top-ranked couplings are
`chase_sweep_lib.bb` (12), `handoff_lib.bb` (8), `mono_router_lib.bb` (6) and
the mono-router/chase test runners — i.e. exactly the cluster this parcel
touched. It also flags `handoff-protocol.md` (3) and `PIPELINE.md` (4),
which corroborates the ticket's own `docs:` requirement (see F4).

### Pre-existing failures — NOT caused by this parcel

Both reproduce identically at the pre-parcel baseline `eb61ff1c4`:

- `bb test` — 4 failures / 6 errors, all `Command failed: ready_for_next.sh`.
- `test_handoffd_notify_verified.sh` case 02 ("must type the wake message
  exactly once").

## Findings for the hardener

**F1 — the ordering-key wiring is untested, and the scenario meant to pin it
does not.** *(the significant one)*

The specifier called this out by name in `specifier_decisions`:

> Omitting aged notes from the ordering key is the silent regression to
> avoid: a note-only mailbox would score an empty timestamp and lose every
> comparison, so the fix would appear to work in the unit test and still
> starve in production — feature scenario 03 row 2 pins it.

It does not pin it. `bl576AgedNoteActionabilitySteps.js` hand-builds the
score rows in JavaScript:

```js
const row = { role: 'specifier', 'newest-created-at': hhmmToIso(createdAt), 'actionable?': true };
```

and calls `preferred-rotate-target` on them — bypassing
`handoffd.bb/role-mail-row`, which is the *only* place the regression could
occur. Delete `aged-notes` from the `(concat held git-hfs aged-notes)` on
line ~998 today and all 24 acceptance scenarios plus every unit assertion
stay green, while note-only mailboxes starve again in production.

`grep` confirms zero coverage of either handoffd wiring point — no test
anywhere references `aged-note-count`, `note_actionable_after_ms`, or
`deliver-notify-skip-dormant-note` outside `mono_router_lib_test_runner.bb`:

- (a) `role-mail-row` feeding `aged-notes` into `:newest-created-at`;
- (b) `maybe-notify!`'s `deliver-notify-skip-dormant-note` branch.

The production code is correct as written — this is a coverage gap, not a
defect, which is why the parcel is forwarded rather than bounced. A
fixture-mailbox wiring test over `role-mail-row` (aged note present → row
carries its `created_at` and `:actionable? true`; fresh note → neither) is
the shape that would make it load-bearing.

**F2 — boundary mutant.** `note-aged?` has no assertion at exactly
`threshold-ms`. `>=` → `>` is a live mutant; the nearest cases are 45 min
and 1 min against a 20 min threshold.

**F3 — two vacuous step handlers** in the scenario-05 block: "the resident
returns to coder between drains" and "all five mailboxes end empty with no
human action" have empty bodies. Their comments justify this by pointing at
pre-existing mechanisms, but Gherkin mutation of those lines will survive.

**F4 — for the documenter.** `preferred-mono-rotate-role`'s docstring still
reads "Broadcast notes never qualify." — now false, aged notes do qualify.
Plus the ticket's own `docs:` scope: a runbook entry for
`note_actionable_after_ms` and the aged-note rotate trigger in
`swarmforge/handoff-protocol.md` and `swarmforge/PIPELINE.md`.

**F5 — observation only, no action wanted.**
`parse-note-actionable-after-ms` duplicates `parse-max-depth`'s body shape
across two libs. Extracting it would add a cross-lib dependency for ~5 lines
and the validation rules genuinely differ (positive-only, no sentinel vs
signed with a `-1` sentinel). Correct as-is; recorded so it is not
re-litigated.

## Property testing

**No property test is warranted for this parcel, and none was manufactured.**

The pure modules it touched are Babashka (`mono_router_lib.bb`). The
project's property harness is fast-check + `*.property.test.js` +
`npm run test:properties`, which is JS/TS only. Reaching the bb functions
from it would mean spawning a `bb` process per generated case (the step
handler's `bb -e` pattern) — a 100-case property becomes minutes, violating
engineering.prompt's "keep the unit suite in seconds". The only JS file the
parcel touched is a test-harness step handler, not a production pure module.

Recorded for whoever wires bb property testing later (BL-472 territory), the
two invariants that *are* property-shaped here:

- `parse-note-actionable-after-ms` returns a positive integer for **any**
  input string — absent, malformed, zero, negative, and garbage all land on
  the default.
- `note-aged?` is monotone in `now-ms`: once true for a given header pair
  and threshold, it stays true for every later `now-ms`.

By architect.
