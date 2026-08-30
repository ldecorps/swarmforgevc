# BL-1297 — architect pass on the in-flight amendment, 2026-08-30

## Verdict: PASS, forwarded to hardender.

This supersedes my prior BL-1297-architect-20260830.md pass, which reviewed
the pre-amendment (single-semantic) contract. The specifier amended the spec
in flight (`backlog/evidence/BL-1297-spec-correction-20260830.md`) after the
hardener found the original contract refused its own forward — DELIVERED
(first-parent delta) charged every clean receive-merge with whatever rode in
via the routine main sync, which is always. This pass reviews the reworked
DELIVERED/AUTHORED split.

## Checks run

- **Dependency gate (hard, BL-259):** ran against the amendment's only
  `extension/` change (`test/bl1297MergeOwnPathsInvariants.property.test.js`,
  test-only) — PASSED, no forbidden edges.
- **Co-change tool (informational, BL-255):** same coupling profile as the
  prior pass (test runner, step index, sibling gate files) — no unexplained
  coupling.
- **Required wiring:** `bl1297MergeCommitOwnPathsSteps` still `require`d at
  `specs/pipeline/steps/index.js:656`. (Coder flagged the entry's own reason
  text still says "four scenarios" though there are now six — cosmetic,
  the specifier's ticket text to fix, not a wiring defect; anchor unaffected.)
- **Unit suites, re-run**: `task_scope_gate_lib_test_runner.bb`,
  `land_step_lib_test_runner.bb`, `unregistered_test_gate_lib_test_runner.bb`
  — ALL PASS.
- **Property suite, re-run**: 3/3 rewritten properties pass
  (`bl1297MergeOwnPathsInvariants.property.test.js`), plus BL-1295's
  neighbouring property test still 3/3. Read the rewritten invariants 2/3:
  reach floors now include a dedicated `evil-merge` shape (the only merge
  shape whose author actually wrote something), and invariant 3 directly
  asserts the land step and the two send-time gates see DIFFERENT answers on
  the same commit — the assertion the amendment exists to make. Non-vacuous.
- **Acceptance, re-run**: `node specs/pipeline/cli.js
  specs/features/BL-1297-a-merge-commits-own-paths-are-not-empty.feature` —
  6/6 scenarios pass (01/04 delivered-semantics unchanged, 02 re-scoped to an
  evil merge, 05 new: clean receive-merge not refused, 06 new: the two
  answers agree on a single-parent commit).
- **Independent git verification** (scratch repos, not just trusting the
  evidence table):
  - `--cc --root` on a root commit reports the introduced tree under both
    semantics — confirmed a root commit cannot fail the gate open.
  - Built an evil merge (two branches plus a manually-added resolution file
    in the merge itself): `--cc` reported only the resolution file
    (`resolution.txt`); the delivered first-parent diff reported both the
    resolution file AND the other branch's file (`a.txt`). Matches the
    ticket's own measured behaviour exactly.

## Architecture / semantics review

- The DELIVERED/AUTHORED split lives entirely in the shared helper
  (`own-commit-changed-paths`, arity-3) — no caller can invent a third
  question, preserving the "one shared walk, three callers" design the
  original ticket already established.
- `land_step_lib.bb`'s three call sites and its `diff-readable?` probe now
  pass `:delivered` EXPLICITLY rather than relying on the helper's default
  — this closes a real self-audit finding the coder caught themselves (a
  future default change could otherwise silently repoint the replay at the
  wrong semantic). Good defensive practice, correctly scoped to this parcel.
  `parcel-own-changed-paths` (both send-time gates' shared seam) now asks
  `:authored` explicitly.
- `-m` remains correctly rejected for both semantics, for the reason
  already established in the original review (attributes the merged-in
  branch's own prior work to the merging role).
- No behavior change to the non-merge, non-root path: `--cc` degrades to
  an ordinary diff on a single-parent commit (verified live above and by
  scenario 06), so DELIVERED and AUTHORED necessarily agree there.

## Invariants review

All three declared invariants (rewritten per the amendment) have live,
non-vacuous property tests. Invariant 2's old "callers agree" claim — the
premise the amendment overturned — is correctly replaced by invariant 3's
"callers deliberately differ," and the property's own floor requires seeing
both a delivered-only case and an authored-visible case, so it cannot pass
by having both callers read the same answer (the shape that shipped and
blocked this ticket's own forward). No missing/vacuous-property-test
send-back.

## Process note

Per `backlog/evidence/BL-1297-spec-correction-20260830.md`, no bounce was
charged to the coder or hardener for the pre-amendment contract — the spec
itself was wrong, not the workmanship. Agreed with that disposition; nothing
to add or contest here.

No defects found. No send-back.
