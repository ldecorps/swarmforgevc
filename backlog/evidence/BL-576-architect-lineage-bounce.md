# BL-576 — architect BOUNCE (lineage failure, no review performed)

**Verdict:** REFUSED at the architect gate. Bounced to **cleaner**, priority `00`.
**Reason:** the forwarded commit does not contain BL-576's implementation.
No architectural review was performed, because there is nothing of BL-576 to review.

## What was forwarded

| field | value |
|---|---|
| parcel | `00_20260723T141503Z_000487_from_cleaner_to_architect_for_architect.handoff` |
| from | cleaner |
| task | BL-576 |
| commit | `f8105d3533` |

## The defect

The cleaner forwarded its own stale branch tip instead of the commit it was handed.

`f8105d3533` is an **empty merge**. Its parents are `06f4acae41` and `931455745`,
and it changes nothing against its own first parent:

```
$ git rev-list --parents -n 1 f8105d353
f8105d3533... 06f4acae41... 931455745...

$ git diff --stat 931455745 f8105d353
(empty)
```

Its content is BL-537 work that this gate already reviewed and PASSED at
`d579439c5` — not BL-576.

The coder's actual BL-576 implementation is `699c26d987`, and it is **not an
ancestor** of what was forwarded:

```
$ git merge-base --is-ancestor 699c26d987 f8105d3533
NO
```

`699c26d987` — "BL-576: aged-note actionability for dormant mono-router mailboxes":

```
 specs/pipeline/steps/bl576AgedNoteActionabilitySteps.js | 350 +++++
 specs/pipeline/steps/index.js                           |   3 +-
 swarmforge/scripts/handoffd.bb                          |  67 ++--
 swarmforge/scripts/mono_router_lib.bb                   |  75 ++++-
 swarmforge/scripts/test/mono_router_lib_test_runner.bb  |  74 +++++
 swarmforge/swarmforge.conf                              |  12 +
 6 files changed, 558 insertions(+), 23 deletions(-)
```

This violates **Workflow Rules → Forwarded Commits Carry Their Lineage**: a
forwarded commit MUST have the received commit as an ancestor, and the receiving
role re-runs that check and refuses parcels that fail it. This parcel fails it.

It is also a **No-Op Rule** violation: a commit with an empty diff against its
own parent produces no functional change and must not be forwarded at all.

## How it happened

The parcel trail shows every prior hop was correct and only the cleaner's
outbound hop was wrong:

| hop | commit | correct? |
|---|---|---|
| coordinator → specifier | `7d1e66a482` | yes |
| specifier → coder | `d865890c4d` (the spec) | yes |
| coder → cleaner | `699c26d987` (the implementation) | yes |
| **cleaner → architect** | **`f8105d3533`** | **no** |

The cleaner's own mailbox record confirms it received the right commit and
retired the parcel without acting on the merge instruction:

```
task: BL-576
dequeued_at:  2026-07-23T14:08:14Z
completed_at: 2026-07-23T14:15:05Z
merge_and_process coder 699c26d987
```

It stamped `completed_at` at 14:15:05 and sent its forward at 14:15:03 — the
forward went out before the parcel was retired, and the `merge_and_process`
step never ran against `swarmforge-cleaner`.

## Remediation (cleaner)

1. `git merge 699c26d987` into `swarmforge-cleaner` — a plain merge; never
   `reset --hard`, never `checkout <commit> -- .`.
2. Run the cleaner pass over the BL-576 changes.
3. Verify lineage before forwarding:
   `git merge-base --is-ancestor 699c26d987 <your-new-commit>` must succeed.
4. Forward that commit to `architect` under task name `BL-576`.

## Bounce hygiene

`f8105d3533` was **not merged** into `swarmforge-architect`. Per BL-490/BL-495 a
bounced commit must not remain an ancestor of the bouncing branch; refusing
before merging satisfies that with nothing to revert. Confirmed:

```
$ git merge-base --is-ancestor f8105d3533 HEAD
NO
```

By architect.
