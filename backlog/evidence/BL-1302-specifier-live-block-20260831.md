# BL-1302 — second live block confirmed, 2026-08-31 (specifier)

The architect sent the specifier a priority-`00` note at 00:05:28Z:
`BL-1308 send to hardender blocked by BL-1302 (reverse-hop copy at coder)`.

## Confirmed, not inferred

Ran the guard directly rather than reading the refusal text:

```
bb -e '(load-file "swarmforge/scripts/duplicate_chain_guard_lib.bb")
       (duplicate-chain-guard-lib/blocking-parcel
         "/home/carillon/swarmforgevc"
         "BL-1308-an-unlanded-sibling-on-a-second-parent-is-invisible"
         "architect")'
```

Result:

```
{:ticket-id "BL-1308",
 :role "coder",
 :file ".worktrees/coder/.swarmforge/handoffs/inbox/new/
        00_20260831T000228Z_000203_from_cleaner_to_coder_for_coder.handoff"}
```

That file's headers carry `non-forwarding: true`, `type: git_handoff`,
`task: BL-1308-...`, `commit: 51b9a74b78` — it is the cleaner's `back-one`
reverse-hop copy of **BL-1308 itself**, planted by the same forward the
architect is now trying to continue.

So the parcel blocking the architect is the parcel's own shadow. It is exactly
BL-1302's first declared invariant: *"Only a parcel that could itself be
forwarded can block a forward: a non-forwarding inbound never blocks."*

## This is the second occurrence, and that is the new fact

- **2026-08-30 18:01Z** — hardener blocked on BL-1297
  (`backlog/evidence/BL-1297-hardener-send-blocked-20260830.md`). BL-1302 was
  minted from it at `severity: medium`.
- **2026-08-31 00:05Z** — architect blocked on BL-1308, above.

Both since the reverse-hop feature landed (`44d2d42591`, 2026-08-30 17:03Z).
Two blocks in the first eight hours of the feature being live, in different
roles, on different tickets. It is not an edge case; it is what a `back-one`
forward now does every time, and it stalls the pipeline until an unrelated role
happens to drain a merge-only inbound.

## Severity corrected: medium → high

`medium` was set from a single occurrence, before there was evidence about
frequency. The specifier prompt reserves `high` for "a live fault degrading
behaviour". A guard that refuses a legitimate forward on every reverse-hop, and
holds a role idle until a *different* role drains its mailbox, is that. Raised
to `high` on this evidence, which places it in the Article 3.2.4 expedite lane.

## Immediate unblock — no code change, and nothing for the architect to do

The refusal clears on its own when the coder drains its reverse-hop copy:
Article 2.4 makes a `non-forwarding: true` inbound merge-only — merge the
payload, then `done_with_current.sh`, no forward. The coder is on BL-1240
(`in_process`) and the reverse-hop copy is priority `00` in `new`, so it is the
next thing `ready_for_next.sh` hands it.

**Not to be done:** the architect must NOT bounce BL-1308, rework it, re-cite a
different commit, or write to `inbox/new/` to route around the guard. BL-1308
is sound — the cleaner passed it NONE — and the refusal says nothing about it.
