# BL-613 — architect PASS (round 4, 2026-07-24)

Reviewed commit: `8feae64373` (cleaner, "verification - test passes, all content restored")
Review merge: `486e9e1e4`
Carries: `1782c6799` (coder, "restore hardener stubs + QA bounce evidence lost to architect's revert")

## Verdict

**PASS — forward to hardender.** Both send-back #3 defects are fixed, and
everything previously cleared is still byte-identical. No new findings.

## Send-back #3 findings — both closed

Send-back #3 bounced this parcel for what was MISSING, not for its content: two
prior stage outputs had been stripped from the tree by my own bounce-hygiene
revert `43ae10f75`. Both are now restored, verified byte-for-byte against the
commits that originally produced them:

| Path | Restored from | Check |
|---|---|---|
| `swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh` | hardener `15f04cbd7` | `diff` vs `15f04cbd7:<path>` → identical |
| `backlog/evidence/BL-613-bounce-20260724.md` | QA `d6042b054` | `diff` vs `d6042b054:<path>` → identical |

The three items already restored in `505ed13306` survived this round's merge
unchanged — each also verified byte-identical, because the deletion-vs-untouched
merge resolution named in send-back #3 is exactly what silently dropped content
twice before:

| Path | Check |
|---|---|
| `docs/how-to/BL-349-stuck-role-escalation-email.md` | identical to `505ed13306` |
| `docs/index.md` | identical to `505ed13306` |
| `docs/reference/Specification.MD` | identical to `505ed13306` |

Send-back #3's own verification command reproduces: `grep -c emit-fleet-status
… → 1`. All five paths present in `git diff --stat main..HEAD`.

Note the hardener's contribution is narrower than send-back #3 implied: `main`
already carries the Node-tool stubs themselves (via `9c4f9b621`), so `15f04cbd7`
is the +6/-2 rationale comment on top of them. Restoring it is still correct —
that comment is why a future maintainer will not strip the stubs a third time —
but the test was never functionally stub-less on `main`.

## Correction to send-back #3

Send-back #3 stated `b86248ab7` ("fix stuck-escalation email wiring test's own
preseed bug") was "already on `main`". It is not — it sits in this parcel's
ancestry (`main..HEAD`). The substance of that fix reached `main` independently
via cleaner commit `9c4f9b621`, which is why the parcel's net diff against
`main` for the test file is only the comment block. The conclusion drawn from it
was right (the preseed/backdate fix is not this parcel's to relitigate); the
attribution was wrong.

## Gates run

- **Dependency gate (REQUIRED HARD GATE)** — full-repo scan:
  `Dependency-rule gate PASSED: no forbidden edges`, exit 0. The parcel contains
  zero TS/JS, so no module boundary is in play; the full scan is the meaningful
  form here.
- **Contract test** — `test_handoffd_stuck_escalation_email_wiring.sh` →
  `ALL PASS`, exit 0, with the restored stub comment in place. All four
  assertions green, including that `write-escalation!`'s file record is
  unchanged by the email leg. This is the ticket's central acceptance (the red
  test flips green) and it holds.
- **Co-change** — the flagged pairs are the docs-registration triple
  (`BL-349-*.md` ↔ `docs/index.md` ↔ `Specification.MD`, frequency 5) plus
  `Specification.MD` as the usual docs hub. This parcel updates all three
  together, which is the correct co-change response. `specs/pipeline/steps/index.js`
  co-changes with the wiring test at 5, but this parcel adds no scenarios, so no
  step-handler registration is owed. Informational only; no action.

## Falsifiable claims in the runbook — re-verified on the merged tree

Re-checked rather than trusted, because line references drift across merges:

- Subject line `SwarmForge: <role> is stuck and needs attention` — matches
  `stuck_escalation_email_lib.bb:144` exactly.
- Threshold `handoffd.bb` line 46, `:stuckInProcessTimeoutSeconds` — the
  reference is still accurate to the line. A repo-wide grep finds the key only
  in `handoffd.bb`, `chase_sweep_lib.bb` (reader) and test runners — never in
  `swarmforge.conf`, so "tuning not yet supported" is true.
- Escalation-log shape (flat `{"coder": true}`, entry removed on recovery) and
  the pointer to the separate `chase-escalation-email-state.json` for
  delivery/retry state — unchanged from the copy verified in send-back #3.

## Architecture review

- **Two-layer boundary** — untouched. Docs plus one shell-test comment block; no
  TypeScript spawns any agent process, tmux remains the substrate.
- **Extension host owns I/O / webview is pure presentation** — no webview or
  extension-host code in the parcel.
- **No browser storage** — no webview code; N/A.
- **Secrets** — grep of both added docs for key/token/secret-shaped strings
  (including `re_*` Resend keys and Telegram bot-token shapes) finds none. The
  runbook documents the alarm's behavior without embedding or instructing the
  writing of any credential into the target repo.
- **Integrate-not-fork** — no SwarmForge source is copied or reimplemented.
- **Scope (BL-506)** — `git diff --name-only main..HEAD` is BL-613's three doc
  paths, the BL-613 wiring test, and BL-613 evidence files only. No functional
  file outside the ticket's scope rides along.
- **Diagrams** — the parcel documents an alarm that already existed (BL-349);
  pipeline topology and the extension/tmux architecture are unchanged, so
  neither Mermaid source under `docs/diagrams/` is owed an update.

## Property testing

No property test is warranted for this parcel, and none was added. Property
tests attach to pure, testable modules with invariants that hold across a broad
input range; this parcel touched zero such modules — its entire content is
Markdown plus a comment block in a Bash test. Manufacturing a property here
would be vacuous. The alarm's own decision logic already has its dedicated
fake-adapter suite (`stuck_escalation_email_lib_test_runner.bb`), which this
parcel does not change.

## Out of scope — confirmed, not reopened

- Everything cleared in send-back #3 ("do not touch these again") was re-verified
  byte-identical and is not relitigated.
- The runbook has no "the email did not arrive" troubleshooting section. That is
  a completeness nit on content the documenter wrote and QA already passed, not
  a defect and not an architectural violation — not grounds for a fifth round.
- `swarmforge ensure` / `kill` wording: pre-existing convention shared with the
  BL-144 doc.
- Making the 60s threshold configurable: the runbook correctly says it is not
  implemented and is tracked separately.

By architect.
