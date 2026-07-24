# BL-613 — architect SEND BACK #3 (2026-07-24)

Reviewed commit: `505ed13306` (coder, "fix runbook to match shipped code")
Review merge: `16dff1695` (reverted per bounce hygiene, BL-490/BL-495)

## Verdict

**SEND BACK to coder.** Not for anything present in the parcel — everything
present is correct. The parcel is **incomplete**: two prior stage outputs are
missing from the tree while commits in the parcel's own history claim they are
there.

**Root cause is mine, not the coder's.** My send-back #2 bounce-hygiene revert
`43ae10f75` (`git revert -m 1` of merge `29b768d39`) reversed *everything that
merge introduced* — including hardener and QA work that had never been on the
architect branch independently and so was only reachable through that merge.
The coder restored three of the five stripped items; nobody had told it there
were five. This note supplies the complete list.

## Verified FIXED — do not touch these again

All three send-back #2 findings are cleared, checked against the shipped source:

1. **Subject line** — doc says `SwarmForge: <role> is stuck and needs attention`;
   matches `swarmforge/scripts/stuck_escalation_email_lib.bb:144` exactly.
2. **Email body** — doc's quoted body matches `email-text`
   (`stuck_escalation_email_lib.bb:111-117`) verbatim, including the
   role-name-only argument. The invented ticket id / log path / recommended
   command are gone.
3. **Escalation-log shape** — doc now shows the real flat `{"coder": true}` map
   written by `write-escalation!` (`chase_sweep_lib.bb:600-603`), with the
   correct pointer to the separate `chase-escalation-email-state.json`
   (`stuck_escalation_email_lib.bb:41-42`) for delivery/retry state.

Also verified:

- **60s threshold** is genuinely hardcoded at `handoffd.bb:46`; a repo-wide grep
  confirms no `swarmforge.conf` override exists, so the doc's "tuning not yet
  supported" is true.
- **Contract test passes**: `test_handoffd_stuck_escalation_email_wiring.sh`
  → `ALL PASS`, exit 0. The ticket's central acceptance (the red test flips
  green) holds, and the root cause is named in the test header and in
  `b86248ab7` (already on `main`).
- **Dependency gate**: full-repo scan `PASSED: no forbidden edges`. The parcel
  contains zero TS/JS, so no module boundary is in play.
- **Co-change**: `docs/how-to/BL-349-*.md` ↔ `docs/index.md` ↔
  `Specification.MD` at frequency 3 (suspected coupling) is the expected
  docs-registration triple — this parcel correctly updates all three together.
  No action.

## The two defects — restore these

### 1. Hardener's Node-tool stubs are gone from the contract test

`swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh` is
**-13 lines vs `main`**. Commit `15f04cbd7` ("harden - restore Node tool stubs
in escalation-email wiring test for log diagnosability", +17 lines) is in the
parcel's ancestry, but its content is **absent from the tree** — my revert
removed it. History therefore claims a hardening pass that the code does not
have.

The hardener's stated reason still stands: without the stubs the daemon log
fills with `MODULE_NOT_FOUND` noise from unrelated sweeps, so a future
failure's `$(cat "$LOG_FILE")` dump shows 58 lines of fleet-status /
answer-drain / pause-resume stack traces instead of this test's own signal
(8 lines with the stubs). For a ticket that exists *because an alarm went dark
and nothing noticed*, the diagnosability of its own wiring test is load-bearing.

Restore verbatim from `15f04cbd7` — the comment block plus the three
`extension/out/tools/*.js` heredocs, inserted after `chmod +x "$FAKE_BIN/tmux"`:

```sh
git show 15f04cbd7 -- swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh
```

### 2. QA's bounce evidence has been erased from the repo entirely

`backlog/evidence/BL-613-bounce-20260724.md` (65 lines, added by QA in
`d6042b054`) is absent from the parcel tree **and** absent from `main`.

This one matters beyond bookkeeping. The constitution's BL-340 rule — *"A Prior
QA Bounce Is Not In Your Worktree — Check It Against `main`"* — instructs every
reviewer to read bounce history from the `main` ref. If this parcel lands as-is,
BL-613's QA bounce record (documenter runbook cited a nonexistent config key and
the wrong threshold) exists nowhere in the repo, and the BL-340 lookup returns
nothing. That is precisely the blind spot BL-340 was written to close.

Restore verbatim:

```sh
git show d6042b054:backlog/evidence/BL-613-bounce-20260724.md
```

## How to restore without losing it a third time

Do **not** assume "it is already in my branch, the merge will carry it." It will
not: my branch has these paths *deleted* by the revert, and for a path the coder
side has not touched since the merge-base, the merge resolves to the deletion.
That mechanism is what silently dropped this content twice.

Per bounce hygiene (BL-490/BL-495) I have reverted my review merge `16dff1695`,
which re-strips the three doc items from the architect branch as well. So the
forwarded commit must land **all five** paths explicitly:

| Path | Intended final content |
|---|---|
| `docs/how-to/BL-349-stuck-role-escalation-email.md` | exactly as in `505ed13306` — verified correct, **do not re-edit** |
| `docs/index.md` | the BL-349 runbook line, as in `505ed13306` |
| `docs/reference/Specification.MD` | the BL-613 changelog line, as in `505ed13306` |
| `swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh` | + the 17-line stub block from `15f04cbd7` |
| `backlog/evidence/BL-613-bounce-20260724.md` | verbatim from `d6042b054` |

Write each one out explicitly rather than relying on the merge to carry it. For
a path the coder side has not touched since the merge-base, the merge resolves
to the architect branch's *deletion* — that mechanism is what silently dropped
this content twice, and it will do so a third time if the commit only re-adds
the two new files.

Verify before forwarding:

```sh
git diff --stat main..<your-commit>   # expect all five paths present
grep -c emit-fleet-status swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh   # expect 1
```

## Out of scope — confirmed, do not reopen

- The `swarmforge ensure` / `kill` wording in the runbook: pre-existing
  convention shared with the BL-144 doc.
- The wiring test's preseed/backdate fix itself (`b86248ab7`): already on
  `main`, already reviewed, root cause named. Not relitigated here.

By architect.
