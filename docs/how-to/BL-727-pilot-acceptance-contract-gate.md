# How to read /pilot's acceptance-contract landing gate (BL-727, BL-729)

BL-718 landed through `/pilot` with a hand-authored acceptance feature file
that had zero step handlers — nothing between "the agent believes it passed"
and `git mv`ing the ticket to `backlog/done/` ever executed the ticket's own
declared acceptance contract. BL-727 closes that gap by making the land
itself the gate.

## What changed

`composePilotExpeditorPrompt` no longer tells the pilot to `git mv` a
QA-stamped ticket to `backlog/done/` directly. It now points the pilot at one
command, and that command is the pilot's **only** landing path:

```
node extension/out/tools/pilot-acceptance-gate.js <TICKET-ID>
```

The gate CLI:

1. resolves the ticket's `acceptance:` field to a feature file;
2. runs that feature file through the project's existing acceptance pipeline
   (`specs/pipeline/runnerAdapter.js` — the same parser and step registry
   every other acceptance run uses, never a second implementation);
3. on a green run, writes an acceptance receipt
   (`.swarmforge/expedite/<TICKET-ID>/acceptance-receipt.json` — feature
   file, landed commit, result) and moves the yaml to `backlog/done/`;
4. on anything else — an unmatched step, a failing scenario, an absent,
   inline-only, or missing-file `acceptance:` declaration, or a commit whose
   own message claims a change its own patch does not support (BL-729,
   below) — refuses. A refused land is inert: no yaml move, no receipt,
   nothing else written. Exit code is `1`; the refusal is still printed as
   JSON on stdout, never only a stack trace.

## Commit-claim check (BL-729)

Between a green acceptance contract and the yaml move, the gate also checks
every non-merge commit the pilot run authored (merge-base with `main` …
`HEAD`) against its own patch:

1. In each sentence of the commit message that attaches a change verb
   (restore, fix, add, remove, delete, drop, rename, revert, correct,
   replace, extract, introduce, wire, close, …) to code, collect the
   code-shaped tokens: backticked spans, `snake_case`/`camelCase`
   identifiers, identifiers ending `!`/`?`, and source-file paths.
2. Refuse (`reasonKind: 'claim-unsupported'`) if any such token is absent
   from that commit's own patch text (added, removed, and context lines,
   plus the changed-path list). The refusal names the commit, the token, and
   the claiming sentence.
3. A commit is judged only against its own patch — never the worktree or a
   sibling branch — so the verdict is reproducible from that commit alone.
4. If the run's own commit range cannot be resolved, the check fails
   **OPEN**: the land proceeds with a warning that claims were not checked,
   rather than blocking on unreadable history.

This closes the BL-636 gap: a landing commit claimed a fix (`deliver!`) that
existed only on an unmerged sibling branch, and nothing compared the message
against the diff before the ticket reached `backlog/done/`.

## Why

A live pipeline run has two independent places that execute a ticket's
acceptance contract for real: BL-112 has the coder generate and run the
entry point, and QA runs the acceptance gate again before merge. The offline
pilot has neither — a single agent walks every hat itself and records each
stage's verdict as prose in `verdict.json`. Nothing required that prose to be
backed by a command and an exit code, so an assertion of coverage was
indistinguishable from a run. BL-718 shipped exactly that way: six of six
scenarios would fail with "no step handler matched" on the first real
run, and no gate ever noticed.

## Where it lives

- Decision logic (pure, deps injected): `extension/src/tools/pilotAcceptanceGate.ts`
- CLI wrapper: `extension/src/tools/pilot-acceptance-gate.ts`
- Prompt wiring: `extension/src/tools/telegramCursorBridgePilot.ts` →
  `composePilotExpeditorPrompt`
- Step handlers for this ticket's own feature file:
  `specs/pipeline/steps/bl727PilotAcceptanceGateSteps.js`
- Tests: `extension/test/pilotAcceptanceGate.test.js`,
  `extension/test/pilotAcceptanceGate.property.test.js`,
  `extension/test/pilotAcceptanceGateCli.test.js`
- Acceptance: `specs/features/BL-727-pilot-acceptance-contract-gate.feature`
- Commit-claim check (BL-729), pure — message/patch text in, unsupported
  claims out: `extension/src/tools/commitClaimCheck.ts`
- Commit-claim git-backed deps (resolves the run's own commit range, reads
  each patch): `extension/src/tools/commitClaimGitReader.ts`
- Commit-claim step handlers:
  `specs/pipeline/steps/bl729CommitClaimCheckSteps.js`
- Commit-claim tests: `extension/test/commitClaimCheck.test.js`,
  `extension/test/commitClaimCheck.property.test.js`
- Commit-claim acceptance:
  `specs/features/BL-729-commit-claims-match-their-own-diff.feature`

## Out of scope

- The automated expeditor (`expedite_cli.bb`) still classifies each stage
  from the agent's self-reported `verdict.json` and runs no gate of its own —
  this fix is `/pilot`-only. See
  [the expeditor reference](../reference/BL-567-expeditor-manual.md) for its
  own (unaffected) landing step.
- BL-718's own missing step handlers, and a repo-wide audit of other
  already-landed tickets whose acceptance contracts cannot execute, are
  separate remaining-work tickets, not this one.
- The commit-claim check (BL-729) is `/pilot`-only, same as the rest of this
  gate. Whether the ordinary live pipeline's pre-QA gate needs the same
  check is a separate, unticketed-here question — the same message/patch
  grammar would need to be re-measured against merge-commit-heavy live
  history before assuming it transfers.
- No retro-check of already-landed commits: `backlog/done/` is not
  re-swept, and BL-636's own `deliver!` discrepancy is owned by BL-728.

## Siblings

- BL-699 — quality and bounce-back rules
- BL-700 — Telegram status posts on ticket / hat / bounce
- BL-701 — orphan acceptance / Stryker cleanup at stage boundaries
