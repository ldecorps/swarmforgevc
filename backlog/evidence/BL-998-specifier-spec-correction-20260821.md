# BL-998 — specifier spec correction (upholds the cleaner's D1)

- **Author**: specifier, 2026-08-21.
- **Trigger**: cleaner `note` (priority `00`), "BL-998 spec gap:
  done_with_current_task.bb is NOT a safe leaf, see evidence."
- **Cleaner's evidence**: `backlog/evidence/BL-998-cleaner-bounce-20260821.md`
  (read at `90aee07f8`).
- **Amendment commit**: see the commit that carries this file.

## Verdict: D1 upheld in full. The fault is the SPEC's, not the coder's.

This ticket's `constraints:` block asserted that both `ready_for_next_task.bb`
and `done_with_current_task.bb` are safe-to-call-directly leaf helpers, and then
**mandated preserving those call sites** — *"The guard must not flag it, and
`test_handoff_state_dir_worktree_root.sh` must keep its lines 86 and 94."*

The coder followed that mandate correctly. It was wrong for
`done_with_current_task.bb`, and the mandate is precisely what kept the unsafe
call site in place. This is a spec-caused defect and is recorded as such.

## Re-verified independently, not taken from the cleaner's report

| Claim | Check | Result |
|---|---|---|
| `done_with_current_task.bb` is self-rooting | `:8 (def script-dir (fs/parent *file*))` | confirmed |
| …via a sibling exec | `:13-14 run-ready!` = `process/exec` of `ready_for_next_task.sh` under `script-dir`; called at `:83` | confirmed |
| `ready_for_next_task.bb` is a true leaf | `grep -c process/exec` | **0** occurrences |
| `done_with_current_task.bb` is not | `grep -c process/exec` | **1** occurrence |
| The mandated line is the unsafe one | `test_handoff_state_dir_worktree_root.sh:16` binds `DONE_TASK` to `$SCRIPT_DIR/../done_with_current_task.bb` (real tree); line **86** is that `bb "$DONE_TASK"` call | confirmed |

`ready_for_next_task.bb`'s `(fs/parent *file*)` uses are `load-file` only —
in-process, no cwd change — which is why the asymmetry is real and the original
constraint was *half* right. The corrected text states the asymmetry explicitly.

## What changed in the ticket

1. `constraints:` — split the two helpers; `done_with_current_task.bb` must be
   called through the fixture's installed copy, with the mechanism spelled out.
2. `constraints:` — added: do not pin line numbers; identify call sites by
   SHAPE. The original numbers were both wrong and fragile.
3. The offender-list "MIXED CASE" bullet — corrected to match.
4. `qa_e2e_procedure` step 6 — rewritten. It previously asked QA to *confirm the
   unsafe call sites were preserved*. It now asks for the opposite, and warns
   that a passing test is not evidence: the existing assertion greps only the
   first line of captured stdout, so post-escape output from the exec'd real
   helper is never checked. Added step 7 to guard the other direction (do not
   convert the true leaf unnecessarily).
5. New `amendment_2026_08_21:` block recording all of the above, plus the
   answer to the cleaner's open guard question (below).

## The cleaner's open question, answered here rather than deferred

*Should the derived guard follow `process/exec` of siblings, so a "leaf" that is
not really a leaf is caught by the guard rather than by hand-inspection?*

**Yes** — and it is not new scope. This ticket's own firm lines already say *"the
guard must be DERIVED, not a list"* and *"decide membership by inspecting what a
test executes"*. The failure was reading "what a test executes" one hop deep. A
guard carrying a hand-declared set of leaf helpers would have classified
`done_with_current_task.bb` as safe — reproducing exactly the bug this ticket
exists to fix, and repeating the BL-948/BL-964 hand-list shape the ticket cites.

Size escape hatch, genuinely meant: if the transitive follow exceeds one sitting,
implement one-hop detection here and raise a sibling for deeper transitivity —
and say so in the handoff rather than silently shipping the smaller thing.

## Routing

The rebuild is already routed: the cleaner bounced D1 to the coder
(`90aee07f8`, merged to coder at `830cb48b5`). This correction lands on `main`
and a `note` goes to the coder — who holds the parcel — to merge `main` and
re-read before rebuilding. No scenarios were added, so no new step handlers are
required (BL-233 does not apply).

## Bounce-ledger attribution (left deliberately uncorrected, and why)

The cleaner already recorded this bounce — `.swarmforge/bounces/2026-08.jsonl`,
one BL-998 entry, `by cleaner`, **`class: behavior`**, commit `90aee07f87`. That
entry is NOT duplicated here: re-recording the same event would inflate the
ledger, and the bounce was the cleaner's to record.

But the class is arguably wrong. The proximate failure was behavioral (the test
escaped into the real tree); the *cause* was `spec-gap` — this ticket mandated
the unsafe call site, and the coder complied. Recorded here in prose because
`extension/out/tools/record-bounce-correction.js` does not exist yet: BL-990,
the ticket that builds exactly this correction verb, is still in flight. Per
BL-635 the ledger step is best-effort and must never block the correction
itself, so it did not.

**Actionable follow-up**: once BL-990 lands, this entry is a real, already-known
instance to correct — `BL-998` / commit `90aee07f87` / `behavior` → `spec-gap`.
Also note the producing-role vocabulary: `record-bounce.js --role` accepts only
`coder|cleaner|architect|hardender|documenter`, so a spec-caused defect has no
way to name the specifier as the producing role at all. That is a gap in the
telemetry model worth a ticket of its own if it recurs.
