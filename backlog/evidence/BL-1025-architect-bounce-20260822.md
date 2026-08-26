# BL-1025 — architect SEND BACK: the reader's verdict vocabulary is a hand-mirrored copy of the writer's, with no test that would catch the two drifting apart

**Parcel:** coder commit `a49f9cac94` (cleaner `446808c530` forwards it
unchanged), merged into architect at `d7a2d9738`.

**Verdict:** SEND BACK to coder.

## Review completed first (Article 4.4 — full inventory before bouncing)

- **Dependency-rule hard gate (BL-259):** N/A for this parcel — zero files
  under `extension/` are touched by the ticket's own commit (`a49f9cac94`
  touches only `docs/`, `specs/pipeline/steps/`, and `swarmforge/scripts/`).
  Ran it anyway: `node extension/out/tools/dependency-gate.js
  swarmforge/scripts/is_qa_ancestor.sh swarmforge/scripts/expedite_lib.bb
  swarmforge/scripts/expedite_cli.bb` → depcruise correctly refuses (files
  outside its `extension/src` scope). Nothing to gate. CLEAN.
- **Co-change coupling (BL-255):** ran
  `node extension/out/tools/co-change-report.js` over the three changed
  scripts. All "SUSPECTED COUPLING" hits are the expected, already-known
  pairs (`expedite_lib.bb` ↔ `expedite_cli.bb`, `is_qa_ancestor.sh` ↔
  `check_pipeline_code_on_main.sh`/`handoffd.bb`). Nothing unaccounted for.
  Not bounced.
- **Declared invariants (2):** both encoded and re-verified live in this
  worktree, not just trusted from the commit message:
  - `bb swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb`
    → `bl1025 expedite-approval properties: 32 cases, exhaustive - ALL
    PROPERTIES HOLD`.
  - `bash swarmforge/scripts/test/test_is_qa_ancestor_expedite_store.sh` →
    `ALL CHECKS PASSED` (9/9, including the fail-closed unreadable/corrupt/
    obstructed rows and the BL-972 self-report guard).
  - Non-vacuity is credible: the commit message reports three
    break-then-restore counts (deleting the store block, relaxing the
    approving-verdict grep, dropping the unreadable-file guard), matching
    this project's own break-then-fix discipline.
  CLEAN — no invariant-unencoded or invariant-violated finding.
- **Property-testing pass (undeclared properties on touched pure modules):**
  the only new pure function is `expedite_lib.bb`'s `qa-hat-verdict-record`;
  it already has direct unit coverage
  (`swarmforge/scripts/test/expedite_lib_test_runner.bb`) plus the exhaustive
  32-case sweep above driving it end to end through the real predicate.
  Nothing to add.

## Defect — the reader's approval vocabulary is a hand-copied literal of the writer's, across a language boundary neither side can import through, with zero test asserting they agree

`expedite_lib.bb` defines the one true set of verdict tokens that count as an
approval:

```clojure
(def advance-verdicts
  "Outcomes meaning 'this gate is satisfied, go to the next stage'. `forward` is a
   real role outcome, not a synonym invented here."
  #{:pass :forward :approved})
```

`qa-hat-verdict-record` writes whichever of those tokens actually fired,
lower-cased, into the JSONL store (`expedite_lib.bb:178`,
`(-> verdict name str/lower-case)`). `is_qa_ancestor.sh` — a **different
language, a different process, no import possible** — re-derives the same
three-token set by hand as a literal bash regex:

```
swarmforge/scripts/is_qa_ancestor.sh:173:
    done < <(grep -E '"verdict":"(pass|forward|approved)"' "$f" \
```

with a comment claiming the two are kept in sync ("The advance vocabulary is
expedite_lib.bb's own `advance-verdicts`.") and nothing that enforces it.
`grep -rln "advance-verdicts" --include="*.bb" --include="*.sh"
--include="*.js" .` returns exactly these two files — no codegen step
produces the bash regex from the Clojure set.

This is precisely the hazard already named in this repo's own Guardrails
article, with its own precedent: *"A constant mirrored by hand across a
language boundary no import can bridge... needs a test asserting both
literals agree — a 'kept in sync' comment is not a gate, and drift fails
silently (BL-897)."* The comment text in `is_qa_ancestor.sh` line 138
("The advance vocabulary is...") is word-for-word the "kept in sync" comment
the guardrail warns is not a gate.

It is not merely theoretical: `expedite_lib.bb`'s own surrounding comment
(lines 95-106) documents that this exact vocabulary has already grown once
for a real reason — a documenter session legitimately returned `forward`,
which the ORIGINAL `pass`/`bounce`-only vocabulary didn't recognise, and
"a legitimate outcome failed the run" until `forward` was added. The set is
explicitly designed to be extended again ("adding a verdict is one edit in
one place"). Every test this parcel adds — the 32-case property sweep, both
shell suites, the unit-test additions in `expedite_lib_test_runner.bb` —
exercises the literal tokens `"pass"` and `"bounce"` only; none of them ever
writes or reads `"forward"` or `"approved"` end to end, and none of them
would fail if a future edit added a fourth advance token to
`advance-verdicts` without touching the bash regex.

**Concrete failure scenario:** a later ticket adds a new legitimate advance
verdict — say `:merged` — to `advance-verdicts` in `expedite_lib.bb` (exactly
the anticipated, one-place edit the surrounding comment describes). The
writer starts recording `"verdict":"merged"`. Nothing in this parcel's test
suite touches the bash side of that boundary, so there is no red test to
prompt updating `is_qa_ancestor.sh`'s regex. The predicate's grep does not
match `"merged"`, falls through to ancestry, answers "no" for a commit an
expedite QA hat genuinely approved, and Article 4.2's babysitter sweep
reports it as landed outside QA — reproducing, verbatim, the exact false
CRIT this ticket exists to eliminate.

## What is NOT the problem (do not over-correct)

- The three tokens currently in both places agree today — this is not a
  live false CRIT right now. It is a drift hazard with no test standing
  between here and the next one, on a boundary this project has already
  been burned by once (BL-897) and wrote a Guardrail about by name.
- The fail-closed handling (unreadable/corrupt/obstructed store,
  BL-972 self-report guard, BL-952 bounce veto) is all correct and
  thoroughly verified — nothing there needs to change.
- Do not weaken `is_qa_ancestor.sh`'s fail-closed discipline to "fix" this;
  the remediation is about the vocabulary literal, not the surrounding
  control flow.

## Remediation

Follow the same pattern this codebase already uses for exactly this class of
problem — `swarmforge/scripts/tool_miss_heal_lib.bb`'s
`MISS-CLASS-PATTERNS`, where "one canonical pattern per class, never two
hand-authored copies that could drift (BL-897 lesson)" is solved by
generating the bash-side snippet FROM the single Clojure definition
(`build-healing-wrapper-command`), not by hand-copying it. Concretely, one of:

1. Have `expedite_lib.bb` (or `expedite_cli.bb`) emit the `advance-verdicts`
   set somewhere `is_qa_ancestor.sh` reads at runtime (a small generated
   fragment/manifest checked in or regenerated by a test), so there is
   exactly one place the vocabulary is spelled; or
2. Short of a shared source, add a test that extracts `advance-verdicts`
   from `expedite_lib.bb` (e.g. via `bb -e`) and asserts it names exactly
   the same token set as `is_qa_ancestor.sh`'s regex — so an edit to one
   without the other fails loudly instead of silently.

Do NOT satisfy this by adding more example rows using the same
`"pass"`/`"bounce"` tokens already covered — the gap is specifically that
`forward` and `approved` (and any future addition) are never exercised
through the writer, and nothing pins the two literals to each other.

— By architect.
