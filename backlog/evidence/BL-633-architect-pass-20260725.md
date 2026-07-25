# BL-633 — architect PASS (2026-07-25)

Parcel received from cleaner `ca0997e877`, merged as `abd8dfdf9`-descendant for
review. Ticket: *"Ticket schema: an `invariants:` section distinct from
`acceptance:`"*.

## Parcel scope

The specifier landed the schema/prompt/retro-fixture half directly on `main`
(`c67c666d8`, "By specifier.") — legitimate, the specifier's worktree *is*
master and those are spec/prompt files. The parcel under review is therefore
exactly the coder's step-handler wiring:

```
specs/pipeline/steps/bl633InvariantsSectionSteps.js  | 166 +++
specs/pipeline/steps/index.js                        |   3 +-
```

No functional file outside the ticket's scope is staged (BL-506 check: clean).

## REQUIRED HARD GATE — dependency-rule checker

`node extension/out/tools/dependency-gate.js` — **PASSED**, no forbidden edges.

Note for future parcels: the gate runs `depcruise` with `cwd = extension/`, so
repo-root-relative paths *outside* `extension/` (like `specs/pipeline/steps/…`)
fail to open and the gate exits 1 on a **tooling** error, not a violation.
Re-run with extension-relative paths (`../specs/pipeline/steps/…`) — that
passes. A full-repo scan (no args) also passes. Pre-existing limitation, not
introduced here.

## Co-change (informational)

`bl633InvariantsSectionSteps.js` co-changes only with `index.js` (1). `index.js`
itself shows high co-change with ~20 files — expected for a central registry
hub, not hidden coupling. No action.

## Architecture review

- Step handlers sit in the APS tree and drive **testable modules** (bb libs,
  live doc files) — never the VS Code UI. ✓
- Two-layer boundary, extension-host-owns-I/O, no webview storage, no secrets,
  no process spawning from a view: all untouched by this parcel. ✓
- `os.tmpdir()` + `mkdtempSync` for the fixture matches project convention
  (185 of 187 sibling step-handler files do the same) — not a deviation.

## Invariants pass (BL-633's own declared invariant)

> "Every existing reader of ticket YAML parses tickets without the new field
> unchanged, and tolerates tickets that declare it"

The ticket explicitly delegates the *class-wide* sweep to the architect, because
scenario 04 samples **one** reader. Swept, not sampled (BL-629's lesson):

| Reader | Method | Result |
|---|---|---|
| bb `backlog_hygiene_lib/field` (scalar) | differential parse, 13 scalar fields, both declaring tickets | **0 differing** |
| bb `backlog_hygiene_lib/violations-for-text` | differential | identical output |
| bb `pre_qa_gate_lib/read-list-field` (block+flow lists) | differential over `required_wiring`, `abandoned_commits`, `roles`, `required_stages`, `depends_on` | **0 differing** |
| TS `backlogReader.parseBacklogYaml` | differential, ticket with vs without the block | **0 differing** (13 and 12 fields) |
| TS `backlogReader.readBacklogFolders` | live backlog | 583 items parsed |
| TS `backlogWriter` | code read | splices via `content.replace` + file moves; never reconstructs YAML, so unknown fields cannot be dropped |

Live CLIs over the real backlog (which now contains BL-633 and BL-590 declaring
`invariants:`):

```
backlog_epic_milestone_audit.bb .          exit 0   (93 open tickets)
specifier_backlog_hygiene_gate.bb BL-633   exit 0
specifier_backlog_hygiene_gate.bb BL-590   exit 0
effective_backlog_depth_cli.bb .           exit 0
pipeline_stage_cli.bb . report             exit 0   ({"BL-633":"architect"})
```

bb reader unit runners: `backlog_hygiene_lib`, `backlog_depth`,
`required_stages`, `ticket_status_lib`, `ticket_close_guard_lib`,
`expedite_lib` — 6/6 pass.

**Invariant HOLDS.** No violating site found, therefore no send-back.

## Acceptance — green *and* non-vacuous

All 5 scenarios pass. A green suite is not evidence, so each was broken and
restored:

| Scenario | Break applied | Result |
|---|---|---|
| 01 schema doc | `Cap: at most 3 entries` → `three` | **fails** ✓ |
| 02 specifier prompt | `State each…` → `Write each…` (line 38) | **fails** ✓ |
| 03 architect prompt | `never one per site.` → `; never…` | **fails** ✓ |
| 04 reader tolerance | audit run on an epic-less fixture | audit **exits 1** ⇒ the `exits zero` gate is load-bearing ✓ |
| 05 BL-590 worked example | `idempotent under` → `upon` | **fails** ✓ |

All three docs restored via `git checkout --`; worktree verified clean.

First attempt at 02 was a false pass: the asserted phrase wraps lines 38–39 and
the handler normalizes whitespace, so a line-based `sed` never matched. Retested
against the real single-line fragment.

## Regression

- Extension suite: **352 files / 5964 tests pass**, 10.0s, within budget.
- No new step-pattern collisions: BL-633's step texts appear in no duplicate
  set. Unregistering `bl633InvariantsSectionSteps` from `index.js` flipped
  **zero** other features from fail→pass ⇒ it shadows nothing.

## Advisories (non-blocking — hardener/documenter)

1. Fixture cleanup lives only in the last step's `finally` (lines 144–146). If
   `the audit exits zero` throws first, the `mkdtemp` directory leaks.
2. The shared step at line 76 asserts the 2-word phrase `legitimate outcome`.
   It is effective today (exactly one occurrence in each doc) but is the
   weakest assertion in the file.
3. `bbField` (line 40) interpolates `HYGIENE_LIB_PATH` unescaped into a Clojure
   string literal — fine for this repo's path, fragile if a path ever contains
   `"` or `\`.

## Follow-ups — deliberately NOT folded into this parcel (BL-506)

1. **Encode the invariant as a property test.** It is currently guarded by one
   fixture pair against one reader plus this one-off manual sweep; nothing stops
   a future `backlogReader` change from breaking tolerance. A fast-check
   property over `parseBacklogYaml` (pure, testable) would make it durable.
   Not added here: `backlogReader.ts` is outside this ticket's touched scope.
2. **≥88 of 358 `.feature` files fail standalone** with "no step handler
   matched". Pre-existing (zero changed when BL-633 was unregistered) and
   unrelated to this parcel. Caveat: the project has no all-features gate —
   acceptance is run per-ticket — so this ad-hoc sweep may not reflect how
   these features are meant to run. Worth triage, not a bounce.

## Property-testing pass

This parcel touched **no pure production module** — only acceptance
step-handler test code. Per the role prompt I say so rather than manufacture a
vacuous property; `npm run test:properties` needs no change. The genuinely
property-shaped invariant belongs to `backlogReader`, untouched here (follow-up
1 above).

## Verdict

**PASS** — forwarded to hardender under task `BL-633`.

By architect.
