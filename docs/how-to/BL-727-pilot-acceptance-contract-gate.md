# How to read /pilot's acceptance-contract landing gate (BL-727, BL-729, BL-731, BL-733, BL-735, BL-737, BL-741, BL-747, BL-753, BL-755, BL-757, BL-758, BL-1215)

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

## Scoped CRAP gate (BL-741)

BL-627 landed `collectReferencedClaudeModels` at CRAP=10.89 with no CRAP pass
— `mutation_cost: low` likely skipped the hardener-equivalent step. BL-741
hardens `/pilot` so **CRAP is always run**, scoped to `extension/*.ts` files
the run's own commits touched. `mutation_cost: low` lightens mutation testing
only; it never exempts CRAP from pilot or pipeline land (also stated in
`swarmforge/roles/hardender.prompt`).

Between a green contract (and the other land gates) and the yaml move:

1. Resolve touched `extension/**/*.ts` paths from the run's non-merge commits
   (same ancestry scope as BL-729).
2. Run scoped CRAP (`pilotScopedCrapCheck.ts` / `extension/scripts/crapReport.js`
   logic) against those files only — not the whole repo.
3. Refuse (`reasonKind: 'crap-violation'`) when any touched function exceeds
   CRAP 6, naming file and function. A refused land is inert: yaml stays put,
   no acceptance receipt.
4. If touched-file history or coverage cannot be resolved, fail **OPEN** with a
   warning that scoped CRAP was not checked.
5. A clean CRAP check does not force land — other gates may still refuse.

**Remediation when refused:** improve tests/coverage for the named function
(companion remaining-work BL-740 for the BL-627 function itself).

## Real-tree docs orphan gate (BL-757)

BL-456's `computeDocsStructure` orphan checker only ever ran against
throwaway fixture trees — never this repo's real `docs/`. Tonight's pilot
landed ten unlinked docs (BL-756) with nothing catching them. BL-757 wires
the checker into two mechanical gates (specifier option 1 — not a checklist
reminder):

1. **Repo-scoped unit suite** — `extension/test/docsStructureRealTree.test.js`
   calls `computeDocsStructure(REPO_ROOT)` and fails on any non-allowlisted
   orphan. Pre-existing debt lives in `extension/test/docs_orphan_known_debt.tsv`
   (dated, explicit — not a silent gut or permanently red suite).
2. **`/pilot` land check** — when the run touches an authored Divio-mode doc
   under `docs/`, `checkOrphanedAuthoredDocs` refuses land if that path is
   orphaned and not allowlisted (`reasonKind: 'orphaned-authored-doc'`).
   Commits that touch no authored docs skip this check.

**Remediation when refused:** link the doc from `docs/index.md` in the
matching Divio section (same commit), or add a dated allowlist entry only for
genuine pre-existing debt — never leave new pilot landings orphaned.

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

## Multi-branch parser per-arm coverage (BL-755)

BL-661's `take-flow-reason` had three parser arms (double-quoted,
single-quoted, unquoted) but every test hit only the double-quoted branch.
Review hats praised the covered hazard without noticing the other arms were
dark (companion remaining-work BL-754).

Between a green contract (and the other land gates) and the yaml move:

1. Collect run-touched `.bb` / `.clj` / `.ts` / `.js` sources and tests
   (same ancestry scope as BL-729 / BL-737 / BL-747 / BL-753).
2. Detect functions whose body is a `cond` / `case` / if-else chain with
   **≥3** distinct arms (lightweight string/keyword markers — not full
   mutation).
3. If no such multi-arm parser was touched → **no-op**.
4. Each arm needs a distinct exercising test (test text includes the arm's
   marker). Refuse (`reasonKind: 'untested-parser-branch'`) when any arm
   lacks one. A refused land is inert.
5. Unreadable touched-file history fails **OPEN** with a warning that
   multi-branch parser coverage was not checked.
6. On a clean check, record `multiBranchParserCoverage` (`parsersScanned`)
   on the acceptance receipt.
7. Hardener prompt + `composePilotExpeditorPrompt` require one distinct test
   per arm before pass — see
   [BL-755 how-to](BL-755-pilot-multi-branch-parser-needs-per-arm-tests.md).

**Remediation when refused:** add a distinct test that exercises the dark
arm (or shrink the parser) — do not silent-bypass. Covering only the
narrated hazard is not enough.

## Per-hat role prompt reinject (BL-758)

`/pilot` used to start with one `composePilotExpeditorPrompt` mega-brief that
said "wear every pipeline hat" without loading `swarmforge/roles/<role>.prompt`
when the casquette changed. BL-723 showed that shape skips gates a role
wearing its own prompt would treat as mandatory. Evidence gates catch silent
skips; they do not restore hat-faithful judgment.

At each hat change and bounce-back:

1. `resetAgent` (or equivalent session boundary), then inject
   `composePilotStagePrompt(ticket, role)` — thin pilot isolation wrapper
   **plus** the full live role prompt bytes (QA → `QA.prompt`), plus pack
   overlay when configured.
2. Do **not** wear every hat from one mega-brief alone; do not merely remind
   the agent of the role name.
3. Every completed stage verdict under
   `.swarmforge/expedite/<ticket>/NN-<role>/verdict.json` must record
   `role_prompt_path` (repo-relative under `swarmforge/roles/`) and
   `role_prompt_sha256` (64-hex of the injected bytes).
4. Land gate `checkPerHatRolePromptEvidence` refuses
   (`reasonKind: 'pilot-hat-prompt-missing'`) when either field is absent.
   A refused land is inert. Telegram hat status (BL-700) is not sufficient
   evidence alone.
5. Unreadable expedite tree fails **OPEN** with a warning.
6. On a clean check, record `perHatRolePromptEvidence` (`verdictsScanned`) on
   the acceptance receipt — see
   [BL-758 how-to](BL-758-pilot-inject-role-prompts-per-hat.md).

**Remediation when refused:** reinject the live role prompt and record path +
hash on the stage verdict — do not silent-bypass.

## Origin/main landing check (BL-1215)

The gate captured local `HEAD` and moved the ticket YAML on that fact alone —
nothing anywhere asked whether the implementation commit existed on the
durable remote. An expedition could pass its own acceptance contract, write
a passing receipt, and mark its ticket done, while the implementation stayed
reachable only from a worktree or an unpushed local branch (BL-1158 failed
in exactly this shape the same day).

Immediately before the yaml move (after every other land gate, using the
same commit `getLandedCommit()` already captures for the receipt):

1. Fetch `origin/main` fresh, then check whether the landed commit is an
   ancestor of it (`checkOriginMainLanding`).
2. Refuse (`reasonKind: 'commit-not-on-origin-main'`) when it is not — the
   refusal names the unlanded commit. A refused land is inert: no yaml
   move, no receipt.
3. **Fails CLOSED** — the deliberate mirror of the commit-claims check's
   fails-OPEN posture (BL-729, above). An unfetchable `origin/main`, no
   remote configured, or an unresolvable commit are all `reachable: false`,
   never waved through with a warning. Treating silence about `origin/main`
   as success is the defect this closes.
4. The gate never pushes. A refusal tells a human (or the pilot) to push
   and re-run; landing the commit remains their next step, not the gate's.

**Remediation when refused:** push the named commit to `origin/main` and
re-run the gate — do not silent-bypass.

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
- Multi-branch parser coverage (BL-755), pure assess helpers:
  `extension/src/tools/multiBranchParserCoverageCheck.ts`
- Multi-branch parser git + test deps:
  `extension/src/tools/commitClaimGitReader.ts` → `checkMultiBranchParserCoverage`
- Multi-branch parser step handlers:
  `specs/pipeline/steps/bl755PilotMultiBranchParserNeedsPerArmTestsSteps.js`
- Multi-branch parser tests:
  `extension/test/multiBranchParserCoverageCheck.test.js`,
  `extension/test/multiBranchParserCoverageCheck.property.test.js`
- Multi-branch parser acceptance:
  `specs/features/BL-755-pilot-multi-branch-parser-needs-per-arm-tests.feature`
- Multi-branch parser how-to:
  [BL-755](BL-755-pilot-multi-branch-parser-needs-per-arm-tests.md)
- Per-hat role prompt evidence (BL-758), pure assess helpers:
  `extension/src/tools/perHatRolePromptEvidenceCheck.ts`
- Per-hat role prompt expedite deps:
  `extension/src/tools/commitClaimGitReader.ts` → `checkPerHatRolePromptEvidence`
- Stage composer: `telegramCursorBridgePilot.ts` → `composePilotStagePrompt`
- Per-hat role prompt step handlers:
  `specs/pipeline/steps/bl758PilotInjectRolePromptsPerHatSteps.js`
- Per-hat role prompt tests:
  `extension/test/perHatRolePromptEvidenceCheck.test.js`,
  `extension/test/perHatRolePromptEvidenceCheck.property.test.js`
- Per-hat role prompt acceptance:
  `specs/features/BL-758-pilot-inject-role-prompts-per-hat.feature`
- Per-hat role prompt how-to:
  [BL-758](BL-758-pilot-inject-role-prompts-per-hat.md)
- Origin/main landing check (BL-1215), pure decision:
  `extension/src/tools/pilotAcceptanceGate.ts` → `checkOriginLanding`
- Origin/main landing git-backed dep (fetch + ancestry check):
  `extension/src/tools/pilot-acceptance-gate.ts` → `checkOriginMainLanding`
- Origin/main landing step handlers:
  `specs/pipeline/steps/bl1215OriginMainLandGateSteps.js`
- Origin/main landing tests: `extension/test/pilotAcceptanceGateCli.test.js`
- Origin/main landing acceptance:
  `specs/features/BL-1215-pilot-land-gate-verifies-the-implementation-reached-origin-main.feature`

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
  re-swept. BL-636's `deliver!` discrepancy was verified and closed by
  BL-728 (2026-08-26): fixed on `main` via `536c16ffb` lineage, not
  `6a2e4aaf6`; see
  [BL-728 how-to](BL-728-handoffd-one-shot-flags-parse-verification.md).
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
- BL-741 — always run scoped CRAP on touched `extension/*.ts` at `/pilot`
  land; `mutation_cost: low` does not skip (companion remaining-work BL-740)
- BL-757 — real-tree docs orphan gate on suite + `/pilot` land when authored
  docs touched (companion remaining-work BL-756)
- BL-747 — refuse land when touched shell tests do not invoke ticket-named
  entry-point scripts (companion remaining-work BL-746 landed)
- BL-753 — refuse land for registered APS patterns that match no rendered
  feature step (companion remaining-work BL-752)
- BL-755 — refuse land when a run-touched ≥3-arm parser has an untested arm
  (companion remaining-work BL-754)
- BL-758 — reinject live role prompts at each hat; refuse land when stage
  verdicts omit `role_prompt_path` / `role_prompt_sha256`
- BL-1215 — refuse land when the implementation commit is not reachable
  from `origin/main`; fails CLOSED on an unreadable remote (mirrors BL-729's
  fails-OPEN posture in the opposite direction)
