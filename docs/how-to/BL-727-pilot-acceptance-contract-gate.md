# How to read /pilot's acceptance-contract landing gate (BL-727, BL-729, BL-731, BL-733, BL-735, BL-737, BL-747, BL-753)

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

## Multi-worktree fixture (BL-731)

BL-637's own acceptance suite fails 8/8 the moment a second worktree's
`handoffd.bb` is running — the multi-worktree reality this repo runs every
day. A pilot that lands lifecycle/teardown tickets after acceptance ran in a
single-worktree sandbox can pass while hiding unscoped survivor scans and
other neighbour-process defects.

Before the gate runs a lifecycle/teardown ticket's acceptance contract, it
now checks the host fixture:

1. **Classify** the ticket as lifecycle/teardown when its `acceptance:` path
   or `required_wiring` names lifecycle scripts or teardown paths (for
   example `kill_pipeline`, `stop-swarm`, `babysitter`, `handoffd_supervisor`).
2. **Assess** the live host: `git worktree list` must show at least two
   linked worktrees, and `ps` must show `handoffd.bb` running for at least
   one root other than the pilot worktree's own.
3. **Refuse** (`reasonKind: multiworktree-required`) when either condition
   fails. The refusal names `single-worktree-only acceptance is insufficient
   for lifecycle/teardown tickets`. A refused land is inert — no yaml move,
   no receipt.
4. **Run** acceptance with `SWARMFORGE_MULTIWORKTREE_FIXTURE` set to JSON
   metadata (`worktreeCount`, `siblingHandoffdRoots`, `pilotRoot`) so step
   handlers can assert the fixture was present.
5. **Record** that metadata on the acceptance receipt (`multiWorktreeFixture`)
   when the contract passes and the ticket lands.

Non-lifecycle tickets are unchanged: the fixture gate is skipped and the
receipt omits `multiWorktreeFixture`.

## Producer output-space crosscheck (BL-733)

BL-642's chrome regex was tested against its own repro text and a few
negatives, but never against `swarmforge.sh`'s `display_name_for_role()` —
the real generator of multi-word and `@`-seat pane titles. Pattern/regex
tickets that recognize producer output can now land only after an exhaustive
crosscheck of that enumerable output space.

Before the yaml move (after the other land gates), for tickets classified as
pattern/regex (acceptance path or `required_wiring` naming pattern/regex/
producer/chrome/pane-title):

1. **Require** producer crosscheck metadata from the acceptance run
   (`SWARMFORGE_PRODUCER_CROSSCHECK` / receipt `producerCrosscheck`).
2. **Refuse** (`reasonKind: producer-crosscheck-required`) when the metadata is
   missing or not exhaustive. Refusal names `missing producer output-space
   crosscheck is insufficient for pattern/regex tickets`. Inert refuse.
3. **Record** `producerCrosscheck` (`producer`, `outputSpaceSize`,
   `valuesChecked`, `exhaustive`) on the acceptance receipt when land succeeds.

Non-pattern tickets skip this gate.

## Acceptance execution (BL-735)

BL-559 double-landed (paused→done, revert, re-land) without ever executing its
named Gherkin feature. Declaration alone is no longer enough.

After a green contract run:

1. **Refuse** (`reasonKind: acceptance-not-executed`) when the ticket's
   acceptance feature exists but was not executed for this landing attempt
   (refusal: `acceptance was declared but not executed for this landing
   attempt`).
2. **Revert-then-reland** tickets (yaml notes mention revert and re-land /
   second land) must also explain *why* the revert and *why* the reland is
   warranted — otherwise refuse (`reasonKind: reland-notes-required`).
3. Both refusals are inert.

## Cross-file duplication (BL-737)

BL-637's landing commit pasted the same twelve-line `--help` block into 16
lifecycle scripts in one sitting. Nothing on `/pilot`'s land path checked for
that mechanical multi-file duplication before `backlog/done/`.

Between a green contract (and the other land gates) and the yaml move, the
gate now checks files touched by the run's own non-merge commits (same
`main`…`HEAD` ancestry scope as BL-729):

1. Collect touched paths from those commits only — never the whole repo and
   never files outside the run's range.
2. Find identical **normalized** consecutive-line blocks of at least 12 lines
   shared by **more than two** of those files (trailing whitespace stripped
   per line). Two-file duplication does **not** refuse.
3. Refuse (`reasonKind: 'cross-file-duplication'`) naming a block fingerprint
   and at least two paths. A refused land is inert.
4. If touched-file history cannot be resolved, fail **OPEN**: land with a
   warning that cross-file duplication was not checked (same posture as
   BL-729 unreadable history).
5. On a clean check, record `crossFileDuplicationFilesScanned` on the
   acceptance receipt.

**Remediation when refused:** factor the shared block into one helper (see
companion remaining-work BL-736 for the BL-637 `--help` bodies) and re-run
the gate — do not silent-bypass.

## Shell entry-point drive (BL-747)

BL-637's lifecycle shell suite claimed to verify `stop-swarm.sh` but
`source`d `stack_survivor_scan.sh` and re-derived refuse/success branching
inline (different success wording; missing `kill_rc` refuse). BL-746 fixed
that remaining work; this gate stops the anti-pattern from landing again.

Between a green contract (and the other land gates) and the yaml move:

1. Collect touched `swarmforge/scripts/test/*.sh` files from the run's
   non-merge commits (same ancestry scope as BL-729 / BL-737).
2. Collect non-test `.sh` basenames named in the ticket YAML (`description`,
   `required_wiring`, `acceptance` prose) — exclude paths under
   `scripts/test/`.
3. If either set is empty → **no-op** (land proceeds).
4. If both non-empty: every named basename must appear as an **invocation**
   in at least one touched shell test (`bash …/name` or `./name`). `source`
   of a helper alone does not satisfy.
5. Refuse (`reasonKind: 'parallel-shell-reimplementation'`) naming the
   entry-point and a touched test path. A refused land is inert.
6. Unreadable ticket YAML or touched-file history fails **OPEN** with a
   warning that shell entry-point drive was not checked.
7. On a clean check, record `shellEntryPointDrive` (`shellTestsScanned`,
   `entryPointsNamed`) on the acceptance receipt.

**Remediation when refused:** drive the real entry-point script from the
shell test (see companion BL-746) — do not silent-bypass.

## Unreachable step handlers (BL-753)

BL-694 registered a step handler that never matched any rendered feature
step. Review hats treated it as a cosmetic dead-code nit instead of asking
what untested behavior claim that handler was meant to prove (companion
remaining-work BL-752).

Between a green contract (and the other land gates) and the yaml move:

1. Collect `specs/pipeline/steps/*.js` files touched by the run's non-merge
   commits (same ancestry scope as BL-729 / BL-737 / BL-747).
2. Pair them with the ticket's acceptance feature. If no step files were
   touched → **no-op**.
3. Every registered pattern (`registry.define` / regex) in those files must
   match at least one rendered step of the feature.
4. Refuse (`reasonKind: 'unreachable-step-handler'`) when a pattern matches
   none. A refused land is inert.
5. Unreadable feature or step files fail **OPEN** with a warning.
6. Review hats (`composePilotExpeditorPrompt` + cleaner/hardener/architect
   prompts) must treat unreachable handlers as untested-behavior flags until
   the claim question is answered — see
   [BL-753 how-to](BL-753-pilot-unreachable-step-handler-untested-behavior.md).

**Remediation when refused:** wire the missing scenario/Examples row (or
delete the dead registration intentionally) — do not silent-bypass.

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
- Multi-worktree fixture (BL-731), pure classification + assessment:
  `extension/src/tools/multiworktreeAcceptanceFixture.ts`
- Multi-worktree fixture wiring (git worktree list, `ps` probe, env export):
  `extension/src/tools/pilot-acceptance-gate.ts` → `runAcceptance`
- Multi-worktree step handlers:
  `specs/pipeline/steps/bl731PilotMultiworktreeAcceptanceSteps.js`
- Multi-worktree tests: `extension/test/multiworktreeAcceptanceFixture.test.js`
- Multi-worktree acceptance:
  `specs/features/BL-731-bl637-pilot-never-ran-acceptance-multiworktree.feature`
- Producer crosscheck (BL-733), pure classification + assessment:
  `extension/src/tools/producerCrosscheckAcceptance.ts`
- Producer crosscheck tests: `extension/test/bl733ProducerCrosscheck.property.test.js`
- Producer crosscheck step handlers:
  `specs/pipeline/steps/bl733PilotProducerCrosscheckSteps.js`
- Producer crosscheck acceptance:
  `specs/features/BL-733-bl642-pilot-missed-multiword-role-crosscheck.feature`
- Acceptance execution (BL-735), pure helpers:
  `extension/src/tools/pilotAcceptanceExecution.ts`
- Acceptance execution tests:
  `extension/test/bl735PilotAcceptanceExecution.property.test.js`
- Acceptance execution step handlers:
  `specs/pipeline/steps/bl735PilotAcceptanceExecutionSteps.js`
- Acceptance execution acceptance:
  `specs/features/BL-735-bl559-pilot-double-landed-without-running-acceptance.feature`
- Cross-file duplication (BL-737), pure block fingerprinting:
  `extension/src/tools/crossFileDuplicationCheck.ts`
- Cross-file duplication git-backed deps (touched paths + file reads):
  `extension/src/tools/commitClaimGitReader.ts` → `checkCrossFileDuplication`
- Cross-file duplication step handlers:
  `specs/pipeline/steps/bl737PilotCrossFileDuplicationGateSteps.js`
- Cross-file duplication tests: `extension/test/crossFileDuplicationCheck.test.js`,
  `extension/test/crossFileDuplicationCheck.property.test.js`
- Cross-file duplication acceptance:
  `specs/features/BL-737-pilot-cross-file-duplication-gate.feature`
- Shell entry-point drive (BL-747), pure extract/invoke helpers:
  `extension/src/tools/shellEntryPointDriveCheck.ts`
- Shell entry-point drive git + YAML deps:
  `extension/src/tools/commitClaimGitReader.ts` → `checkShellEntryPointDrive`
- Shell entry-point drive step handlers:
  `specs/pipeline/steps/bl747PilotShellTestDrivesNamedEntryPointSteps.js`
- Shell entry-point drive tests:
  `extension/test/shellEntryPointDriveCheck.test.js`,
  `extension/test/shellEntryPointDriveCheck.property.test.js`
- Shell entry-point drive acceptance:
  `specs/features/BL-747-pilot-shell-test-drives-named-entry-point.feature`
- Unreachable step-handler gate (BL-753), pure assess helpers:
  `extension/src/tools/unreachableStepHandlerCheck.ts`
- Unreachable step-handler git + feature deps:
  `extension/src/tools/commitClaimGitReader.ts` → `checkUnreachableStepHandlers`
- Unreachable step-handler step handlers:
  `specs/pipeline/steps/bl753PilotUnreachableStepHandlerUntestedBehaviorSteps.js`
- Unreachable step-handler tests:
  `extension/test/unreachableStepHandlerCheck.test.js`,
  `extension/test/unreachableStepHandlerCheck.property.test.js`
- Unreachable step-handler acceptance:
  `specs/features/BL-753-pilot-unreachable-step-handler-untested-behavior.feature`
- Unreachable step-handler how-to:
  [BL-753](BL-753-pilot-unreachable-step-handler-untested-behavior.md)
- Multi-branch parser per-arm coverage (BL-755):
  [BL-755](BL-755-pilot-multi-branch-parser-needs-per-arm-tests.md)

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
- BL-731's fixture gate is `/pilot`-only, same as BL-727/BL-729. The
  ordinary live pipeline's pre-QA gate does not yet enforce multi-worktree
  fixture metadata — lifecycle tickets there still depend on the host
  actually running several worktrees during acceptance, not a gate refusal.

## Siblings

- BL-699 — quality and bounce-back rules
- BL-700 — Telegram status posts on ticket / hat / bounce
- BL-701 — orphan acceptance / Stryker cleanup at stage boundaries
- BL-731 — lifecycle/teardown tickets require multi-worktree acceptance
  fixture before `/pilot` land (companion BL-730 remaining-work on unscoped
  survivor pgrep)
- BL-733 — pattern/regex tickets require producer output-space crosscheck
  (companion remaining-work BL-732)
- BL-735 — refuse land when acceptance was declared but not executed;
  revert-then-reland notes required (companion remaining-work BL-734)
- BL-737 — refuse land on identical ≥12-line blocks in >2 touched files
  (companion remaining-work BL-736)
- BL-747 — refuse land when touched shell tests do not invoke ticket-named
  entry-point scripts (companion remaining-work BL-746 landed)
- BL-753 — refuse land for registered APS patterns that match no rendered
  feature step (companion remaining-work BL-752)
