# Quarantine-lift and recovery-filter checks require authorship, not byte-identity (BL-1211)

*How-to. Task-oriented: understand why a quarantine lift can be refused on a
branch that looks tree-complete, and how to run the operator-facing checks
by hand.*

## What it catches

Two rules govern a review branch, and until this ticket they could
contradict each other with nobody able to tell:

- A bounce must be reverted out of the bouncing branch — the check is that
  the **content** is gone (BL-490/BL-495; ancestry proves nothing).
- A branch recovered from a tree collapse must be missing nothing relative
  to its siblings — the check is that merging it deletes nothing from them
  (`git merge-tree` deletion diff).

A branch whose sibling still holds the bounced content cannot satisfy both:
restoring everything the sibling has drives the deletion diff to zero, and
it restores the bounced content along with everything else. This is exactly
what happened on 2026-08-27: `1fcd4c167` reverted 511 lines of bounced
BL-1189 content out of `swarmforge-architect`; four minutes later a tree-
collapse recovery restored two of those files from `swarmforge-hardender`;
the deletion diff against siblings read zero and the quarantine was lifted
with the bounced content back in place.

## The rule: authorship, not byte-identity

A recovery never resurrects content a revert on that same branch
deliberately removed. Content re-introduced by a recorded post-revert
decision on the branch passes the lift check even when byte-identical to
what the revert removed; content with no such record is refused even
though its bytes are correct. Identity is what makes the question worth
asking, never the answer to it — a genuine re-fix that reinstates the exact
same content, authored by a real commit, still lifts.

## Where it lives

| Piece | Location |
| --- | --- |
| Decision logic | `gatherBounceResurrectionFacts`, `decideQuarantineLift`, `decideRecoveryFilter` — `extension/src/metrics/bounceResurrectionGitAdapter.ts` |
| Recovery-direction filter (BL-1189 prevention) | `filterRecoveryPaths` — same file; refuses to let a sibling-restore bring back a path a revert removed unless a later commit authored it back |
| Lift-verdict production caller | `quarantineLiftCheck` — same file |
| Operator CLI: lift verdict | `extension/src/tools/quarantine-lift-check.ts` |
| Operator CLI: recovery filter | `extension/src/tools/recovery-filter-check.ts` |
| Acceptance steps | `specs/pipeline/steps/bl1211QuarantineLiftAuthorshipSteps.js` |
| Acceptance | `specs/features/BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature` |

## Running the checks by hand

Before lifting a quarantine on a recovered branch, or before restoring
paths from a sibling during a recovery, run the operator-facing CLIs
instead of judging by the deletion-diff alone:

```bash
# Is this branch clear to have its quarantine lifted?
node extension/out/tools/quarantine-lift-check.js --root <repo> --by <role> [--branch <ref>]

# Which of these candidate paths are safe to restore from a sibling?
node extension/out/tools/recovery-filter-check.js --root <repo> --by <role> --sibling <ref> --paths <comma-separated>
```

Both are thin wrappers (compile first — `extension/out/` is gitignored):
`quarantine-lift-check` exits 0 with `granted:true` on a clean lift and
exits 1 with `granted:false` on a refusal, including the fail-closed
"could not decide" shape (refused because the branch's bounce history
could not be resolved, never reported as clean). `recovery-filter-check`
exits 0 when every candidate path is safe to restore and exits 1 when at
least one is held back — each path's individual `restore: true/false`
decision is in the printed JSON either way.

## If a lift or a restore is refused

The refusal names the ticket whose bounced content came back (lift) or the
path held back (recovery filter). Do not hand-restore the named path —
that reproduces the exact BL-1189 incident this ticket exists to prevent.
If the content genuinely needs to come back, author it back with a real
commit (a deliberate re-fix, or a commit that explicitly reinstates the
removed content) and re-run the check; a commit-backed reinstatement lifts
even when byte-identical to what the revert removed.

## Related

- [BL-1213 parcel-rollback guard](BL-1213-parcel-rollback-guard.md) — the send-time sibling: catches a ticket's own path silently rolling back at `git_handoff` time, a different chokepoint than the quarantine-lift/recovery direction this ticket covers.
- [BL-1205 tree-collapse guard](BL-1205-tree-collapse-guard.md) — the containment half of the same 2026-08-27 incident thread (stops a mass-deletion forward); this ticket is the recovery-correctness half (stops a recovery from bringing back what a bounce removed).
- [BL-1208 bounce-revert remedy requires authorship](BL-1208-bounce-revert-remedy-requires-authorship-not-liveness.md) — the same authorship-not-liveness distinction, applied to `record-bounce.js`'s suggested remedy instead of the lift/recovery checks.

## Verify

```bash
npx vitest run --coverage extension/test/bounceResurrection.test.js extension/test/bl1211OperatorCli.test.js
node specs/pipeline/cli.js specs/features/BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature
```

Acceptance: `specs/features/BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature`
