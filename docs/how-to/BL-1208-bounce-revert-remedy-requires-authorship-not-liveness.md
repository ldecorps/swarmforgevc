# A bounce-revert `remedy` requires established authorship, not liveness alone (BL-1208)

*How-to. Task-oriented: understand why `record-bounce.js` may report a
`violation` with no `git revert` remedy, and when to trust the withheld
remedy.*

Fix to the BL-954 bounce revert check. Full mechanics:
[`swarmforge/handoff-protocol.md`](../../swarmforge/handoff-protocol.md#bounce-revert-verification-bl-954).

## What it fixes

`decideBounceRevertVerdict` (`extension/src/quality/bounceRevertVerdict.ts`)
offered a ready-to-paste `git revert --no-edit <commit>` command whenever a
bounced commit's content was still live at the bouncing branch's tip. That
is true of every healthy commit that changed a file, not only a bounced
defect — the check never established that the named commit *authored* the
content it was complaining about, only that the content is *live*.

This fired for real on `0bf05774a`, a recovery commit that had just
restored 13 files an earlier incident had silently dropped. Following the
offered remedy would have re-deleted every one of them, including the
implementation file whose disappearance started the whole incident thread.

## The fix

The adapter (`extension/src/metrics/bounceRevertGitAdapter.ts`) now gathers
one extra fact per live file: `restoredFromEarlierHistory` — true only
when **both**:

1. The bounced commit *added* the path (its immediate parent lacked it
   entirely — a plain edit is never a candidate), and
2. That exact byte-identical content already existed at some strictly
   earlier commit in the **same bouncing branch's own history**.

Scoped deliberately to the branch's own history, never a sibling branch's
tip — a sibling could coincidentally hold identical content for unrelated
reasons (two roles independently authoring the same trivial fix), which
would launder a genuine violation into a false withheld remedy.

`decideBounceRevertVerdict` withholds `remedy` (sets it `null`) only when
**every** live file is so established. The `violation` verdict and every
`liveFiles` path are still reported exactly as before either way — BL-954's
no-silent-clean invariant is unchanged; only the destructive instruction is
withheld when the check cannot tell restoration from authorship.

## What it does NOT change

- An unreverted bounce that genuinely authored the live content still
  reports `violation` with the `git revert` remedy — even when identical
  content also happens to exist on a sibling review branch (that alone
  never withholds the remedy; only the branch's *own* prior history does).
- The `breach-report` verdict for a commit already an ancestor of `main` or
  `origin/main` is unchanged (no remedy either way, for a different
  reason).
- The `clean` and `undeterminable` verdicts are unchanged.
- `appendBounceRecordIfNew` still runs before the revert check (BL-954
  invariant 3) — this ticket does not touch that ordering.

## Where it lives

| Piece | Location |
| --- | --- |
| New fact gathered | `extension/src/metrics/bounceRevertGitAdapter.ts` — `existedIdenticallyBeforeLoss` |
| Verdict decision | `extension/src/quality/bounceRevertVerdict.ts` — `decideBounceRevertVerdict` |
| Acceptance steps | `specs/pipeline/steps/bl1208RestorationNotAuthorshipSteps.js` |
| Unit coverage | `extension/test/bounceRevertRestoration.test.js` |

## Related

- [BL-1213 parcel-rollback guard](BL-1213-parcel-rollback-guard.md) — sibling ticket in the same incident thread (silent branch rollback), different chokepoint (send-time, not bounce-time).
- `swarmforge/handoff-protocol.md`'s "Bounce Revert Verification (BL-954)" section — the check this fix refines.

## Verify

```bash
npx vitest run extension/test/bounceRevertRestoration.test.js
node specs/pipeline/cli.js specs/features/BL-1208-revert-remedy-requires-authorship-not-liveness.feature
```

Acceptance: `specs/features/BL-1208-revert-remedy-requires-authorship-not-liveness.feature`
