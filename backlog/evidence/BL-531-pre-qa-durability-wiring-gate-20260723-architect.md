# BL-531 — architect review

**Verdict: PASS.** Forwarded to the hardener at the reviewed commit.

Reviewed commit: `72e8a2aad9` (my merge of the cleaner-forwarded coder work
`75a6ca545b`) on `swarmforge-architect`. Ancestry confirmed:
`git merge-base --is-ancestor 75a6ca545b 72e8a2aad9` holds.

Parcel scope (BL-531's own commit `75a6ca545b`) is 10 coherent files: the four
`pre_qa_gate*` `.bb` scripts + `.sh` wrapper, the `swarm_handoff.bb` wiring, the
step handler + its registration in `specs/pipeline/steps/index.js`,
`backlog-schema.md`, and `specifier.prompt`. The backlog/topic YAMLs in the
merge diff rode in on a main-sync via the cleaner branch, not BL-531's
functional commit — no ticket-less functional files (BL-506 clean).

## Hard gate — dependency rules (BL-259)

```
node extension/out/tools/dependency-gate.js            # full-repo sweep
  -> Dependency-rule gate PASSED: no forbidden edges.   (exit 0)
```

No `extension/src/*.ts` in the parcel, so there are no policy/view/host-io edges
to add; the full-repo sweep is clean. The changed code is `.bb` swarm machinery,
outside the dependency-cruiser ruleset's TypeScript scope.

## Layering — exemplary pure/impure separation

```
pre_qa_gate.sh (zsh) -> pre_qa_gate_cli.bb   (argv, exit codes, System/exit)
                              |
swarm_handoff.bb::validate ---+--> pre_qa_gate_gather_lib.bb   (ALL git + fs)
   (QA-edge call site)               |
                                     v
                            pre_qa_gate_lib.bb   (PURE: no git, no fs, no proc)
                                     ^
                            pipeline_stage_lib / handoff_lib (reused vocab)
```

- `pre_qa_gate_lib.bb` — the decision surface — imports only `clojure.string`.
  Every git/fs fact (`role-branch-commits`, `main-reachable-set`,
  `cited-ancestors-set`, `file-contents`, `abandoned-commits`) is INJECTED, so
  `evaluate` is a total function of plain data. High-level policy is independent
  of I/O, exactly as `qaBounce.ts` / `siblingDeferral.ts` are on the TS side.
- `pre_qa_gate_gather_lib.bb` holds all `babashka.process` / `babashka.fs`
  access and has no top-level `-main`, so it is `load-file`-able by both
  `swarm_handoff.bb` (the live call site) and test/step-handler code without a
  CLI-exit side effect — the same split as `commit_integrity_lib/cli`.
- `pre_qa_gate_cli.bb`'s `-main` is a thin wrapper: arg validation (exit 2),
  repo/commit resolution, delegation to `findings-for-git-handoff`, exit-code
  mapping (0 OK / 1 findings / 2 usage). No decision logic trapped in `main`.

## Fail-open / fail-closed contract — faithfully built

- Infrastructure failures **allow** the send with a warning: `role-branches`
  returns `{:warnings}` for a missing `roles.tsv` or an unreadable worktree;
  `branch-commits` / `ancestor-of?` return nil/false on git failure and are
  skipped; a missing `main`/`origin/main` ref is not an error (decision 4). The
  wiring into `swarm_handoff.bb`'s `validate` only ever `conj`s *findings*, never
  warnings, into the error list — `pre-qa-gate-errors` prints warnings to
  `*err*` and returns `[]` when there are no findings.
- **Fail-closed only on a positive finding**, including a malformed
  `required_wiring` *entry* (`:manifest`, `wiring-findings`) and a malformed
  `required_wiring` *list* (`:manifest`, `gather` line ~186, the present-but-
  unparseable case — correctly distinguished from field-absent).
- Arming is narrow: `gate-armed?` requires `git_handoff` AND `QA` ∈ recipients
  (membership, verified against `to: QA,documenter`); a task name with no
  extractable ticket id skips silently. No new exit path — findings + the remedy
  line flow through the existing `error-report`.

## Correctness spot-checks (read, not eyeballed)

- `message-references-ticket?` word-boundary token match verified:
  `\bBL-49\b` does **not** match `BL-490`; `\bBL-490\b` **does** match
  `BL-490-VIOLATION` (trailing `-` is a non-word boundary). `Pattern/quote`
  escapes the id.
- `parse-wiring-entry` splits on the first two `::` only, so a `::` may appear in
  `why` but not `path`/`pattern`; empty path or pattern → nil (parse failure).
- `evaluate` orders ancestry findings before wiring findings; branches sorted,
  entries in declared order — deterministic multi-line output.
- Set membership (`main-reachable-set`, `cited-ancestors-set`) and
  `abandoned_commits` prefix-matching are all keyed on the 10-char abbreviation
  consistently across gather + lib.
- Worktrees share the object store, so `git -C <sender-root> log <role-branch>`
  resolves every role branch from any single checkout — the gather layer's core
  assumption holds.

## Runtime wiring — LIVE, not dark (dogfood)

`git show 72e8a2aad9:swarmforge/scripts/swarm_handoff.bb` references
`pre_qa_gate_lib` (load-file + `validate` call). The mechanism runs on the live
send path; the ticket's own `required_wiring`
(`swarm_handoff.bb::pre_qa_gate_lib::...`) is satisfied at the cited commit.
Unit runner green: `bb .../pre_qa_gate_lib_test_runner.bb -> ALL PASS`.

## Co-change (BL-255)

`swarm_handoff.bb`'s suspected couplings — `handoffd.bb` (6), `handoff_lib.bb`
(3), the inject/ready scripts — are the pre-existing handoff subsystem. BL-531's
change is a **send-time** `validate` addition; the refusal happens *before
enqueue*, so `handoffd.bb` (delivery) legitimately needs no change. Correct
boundary, not a missed co-change. New `pre_qa_gate*` files have no history yet.

## Property testing (architect-owned phase)

No `extension/src/*.ts` pure module was touched, so there is **no fast-check
property target** in this parcel. The pure decision surface here is
`pre_qa_gate_lib.bb` (Babashka); its verification is the `.bb` unit runner
(`pre_qa_gate_lib_test_runner.bb`), the real gate for swarm scripts per
engineering.prompt's tool table — green. No property test added; none warranted.

## FINDING (non-blocking, surfaced) — the gate flags a benign stranded merge commit on its OWN parcel

Running the shipped self-check on this parcel reproduces a real finding:

```
$ pre_qa_gate.sh BL-531-pre-qa-durability-wiring-gate 72e8a2aad9 .
PRE_QA_GATE_FAIL ancestry BL-531 aca611925c stranded on swarmforge-cleaner   (exit 1)
```

`aca611925c` is the **cleaner's merge commit** ("merge coder work for BL-531")
on `swarmforge-cleaner`. It satisfies all four Check-A conditions — names the
ticket, on a role branch, not on `main`, not an ancestor of the cited commit —
so the gate flags it. But its functional diff against the parcel is **empty**:

```
git diff 75a6ca545b aca611925c -- swarmforge/ specs/ extension/   ->  (empty)
```

Its only unique content is the *sibling* BL-532 line + backlog bookkeeping (its
second parent `c389f60e5`). The cleaner deliberately forwarded the isolated
coder commit `75a6ca545b` (batch per-ticket isolation, Article 2.6) rather than
its bundled tip, stranding a ticket-named merge that carries no BL-531 work.

**Why this is a PASS, not a send-back:** the gate behaves exactly as specified —
this is a *true* stranded-ticket-named commit, and the design already provides
the reviewable remedy (`abandoned_commits:`, feature scenario 06,
`human_approval: approved`). There is no code defect to fix; the code is correct
against an approved spec. It does not self-block BL-531's transit either: the
gate is not on `main`, and worktree `swarm_handoff.bb` is hot-synced from main
(BL-373), so main's pre-gate version serves the documenter→QA edge.

**Two recommendations routed to the specifier (rule_proposal filed):**

1. **Dogfood integrity — record `aca611925c` under BL-531's own
   `abandoned_commits:`.** Without it, if the branch gate ever *were* live at
   BL-531's QA edge, the parcel would be refused for the spurious `ancestry` FP
   rather than cleanly passing on its (present) wiring — muddying QA end-to-end
   step 8 / scenario 08, the ticket's central dogfood claim. This is a specifier
   ticket-YAML amendment (the YAML is not in the coder's commit), not a coder fix.

2. **Design interaction (candidate refinement).** Condition 3 excludes
   *on-main* bookkeeping, but a batch role's *off-main* ticket-naming merge
   commit is a new false-positive class the spec did not anticipate. Once the
   gate lands on `main` and hot-syncs everywhere, any ticket whose transit
   strands a ticket-named merge (a role writing a custom "merge … for BL-XXX"
   message, as this cleaner did for BL-531 but not BL-532) will be refused at
   its QA edge. Sporadic today, but it touches the specifier's own flagged #1
   risk ("a false positive stops the pipeline, not just one parcel"). Options
   for the specifier: exclude merge commits from Check A, exclude commits whose
   tree adds nothing over the cited commit, or standardize role merge messages
   to the default (non-ticket-naming) form. Reporting rather than silently
   deciding — this is a spec call.

## Scope note (informational)

Untracked `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh`
sits in the worktree; it is operator/infra tooling, unrelated to BL-531, and was
NOT staged into the review commit (BL-506).
