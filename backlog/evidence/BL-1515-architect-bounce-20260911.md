# BL-1515 — architect review pass, 2026-09-11 (bounce)

Commit reviewed: 34ded6fbfc (cleaner's forward, "BL-1515: cleaner review
pass evidence (NONE)").

## Checklist run

- Dependency-rule gate (`extension/out/tools/dependency-gate.js`) on the
  parcel's changed JS: PASSED, no forbidden edges (the parcel touches no
  extension/src file).
- Co-change report (`extension/out/tools/co-change-report.js`) on the
  parcel's changed files: no pairing reaches the default frequency-3
  threshold — nothing flagged.
- Declared invariant 1 (ref changed only in the one safe shape): encoded as
  a non-vacuous property test (`branch_identity_guard_lib_property_runner.bb`,
  300 runs, P1/P2/P3, break-then-fix against a `broken-always-repair`
  stand-in) — ran green.
- Declared invariant 2 (guard runs before the inbox is read): not
  property-encodable (quantifies over wiring order, stated reason recorded
  in the property runner's header); covered instead by the feature's own
  acceptance scenarios, which run the real `ready_for_next.bb` end to end.
  Ran `node specs/pipeline/cli.js specs/features/BL-1515-....feature`:
  5/5 scenarios pass.
- Pure decision-lib unit runner (`branch_identity_guard_lib_test_runner.bb`):
  ran green, registered standing in `suite-manifest.tsv`.
- `ready_for_next.bb` wiring: `branch_identity_guard_lib.bb` is loaded
  right after the BL-1195 worktree-drift guard (line 13, next to line 12)
  and runs before `dispatch-lib/run-dispatch!` — matches `required_wiring`
  and invariant 2's insertion point.
- Read the decision lib against `tree_collapse_guard_lib.bb`'s
  `recipient-branch-ref` accessor — both resolve the declared branch via
  `(:session (handoff-lib/load-role-info ...))`, so the two can never drift
  (BL-897), as the ticket requires.
- No architecture-rule violation (two-layer boundary, host-owns-I/O,
  webview storage, secrets) — the parcel touches no extension/webview code.
- Scope: `git diff --stat` between the pre-ticket base and this commit
  touches only the 7 files the ticket's own description calls for; nothing
  out-of-scope staged.

## D1 — deliverable 3 (the live repair) is asserted, not recorded in evidence (behavior)

The ticket's `human_approval.approval_context` is FIRM on this point:

> The one-shot repair of the live coder worktree (`side` -> `swarmforge-coder`)
> is that same safe shape and is done in this parcel, **recorded in evidence
> with before/after `git worktree list` output**.

And the ticket's own "What is wanted" item 3 requires the same: "records
before/after in the parcel evidence."

The coder's commit (6ef1850adb) narrates, in prose, that ".worktrees/coder
is already checked out on `swarmforge-coder` at 10064197b0" and that "the
rename ... had already been performed by hand before this parcel, and
needed no further action here." That claim is independently verifiable and
true — I confirmed it myself (`git worktree list` shows `.worktrees/coder`
on `swarmforge-coder` at the current tip; `git reflog show swarmforge-coder`
in that worktree carries the branch's full history back through the
`side`-era commits with no rename break) — but there is no
`backlog/evidence/BL-1515-coder-*.md` (or equivalent) file, and no actual
`git worktree list` before/after command output anywhere in the parcel.
`git log --all --oneline --grep="BL-1515"` and `find backlog/evidence
-iname "*1515*"` turn up only this bounce and the cleaner's own NONE
evidence — no coder evidence file for the live repair exists.

A commit-message narrative is not the same artifact the approval demanded:
every other pass in this codebase records evidence as a committed
`backlog/evidence/` file (the cleaner's own `BL-1515-cleaner-20260911.md`
right beside it is the same-parcel precedent), and the approval explicitly
asked for actual command *output*, not a paraphrase of it — the point of a
FIRM tap is that a human read and approved the exact shape of what would be
done, and the parcel should show that shape happened, not merely assert it.

**Remediation**: the coder adds a `backlog/evidence/BL-1515-coder-<date>.md`
evidence file (committed) that:
- Names the worktree's current branch/tip (`git -C .worktrees/coder
  rev-parse --abbrev-ref HEAD` / `rev-parse HEAD`, or the relevant
  `git worktree list` line) as the "after" state.
- Establishes the "before" state from durable history — the ticket's own
  forensics already cite `git reflog show side` showing creation at
  2026-09-03 12:46:29; since the live rename predates this parcel and
  cannot be re-run destructively just to capture a fresh "before" line, the
  evidence should carry the reflog/branch-history proof that the rename
  that happened was exactly the safe shape (declared ref absent, tip
  unchanged) invariant 1 requires — not merely restate the commit message.
- If the coder instead prefers to make the parcel itself perform the
  (now-idempotent, `:ok`) guard run and captures genuinely fresh
  before/after output, that also satisfies the requirement and is simpler.

No other finding surfaced. Forward to the coder only for D1 above; nothing
else here blocks.

By architect.
