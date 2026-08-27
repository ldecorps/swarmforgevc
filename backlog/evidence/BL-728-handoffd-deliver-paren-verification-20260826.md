# BL-728 — coder verification (2026-08-26)

## Question

Independently of BL-636's commit message, is the "one-shot handoffd flags
blocked under streaming eval" bug fixed on current `main`, and which commit
actually closes it?

## Bug scenario (BL-636 / BL-723)

When `swarmforge/scripts/handoffd.bb` has an unbalanced `deliver!` close-paren,
Babashka's streaming eval fails while reading the file (`EOF while reading,
expected ) to match (`). The entire script is unusable — including every
one-shot CLI flag (`--poll-once`, `--sweep-once`, `--print-preferred-rotate-target`,
`--startup-notify-only`, `--chase-sweep-once`) whose `-main` cond branches
never become reachable.

## Timeline (commit references)

| Commit | What happened to `deliver!` tail | Parse under bb? |
|--------|----------------------------------|-----------------|
| `5f9a79511` (BL-611 port) | `(log! "delivered" (str path)))))))))` — balanced, no enqueue | **PASS** (analysis/load) |
| `9bc8de790` / `38f6d21a6` (BL-611 productize) | Removed `enqueue-babysitter-wake!` but dropped one `)` → `(log! "delivered" (str path)))))))))` (7 closes) | **FAIL** — `EOF while reading, expected ) to match ( at [422,1]` |
| `6a2e4aaf6` (BL-636 landed) | Merge kept HEAD's `enqueue-babysitter-wake!` line — incidental re-balance | **PASS** (file loads) |
| `536c16ffb` (merge documenter BL-783) | Restored `5f9a79511` lineage: 9 closes, enqueue removed | **PASS** |
| `5f0f43f12`+ (BL-902 and later) | Same balanced 9-close form, no enqueue | **PASS** |
| `79c5d09b8` (expedite/BL-571 sibling, **never merged**) | Explicit `)` restore with comment; same balanced form | **PASS** |
| **HEAD** (`swarmforge-coder` tip) | `(log! "delivered" (str path)))))))))` at line 556 | **PASS** |

Reproduced live in a detached worktree at `9bc8de790`:

```text
bb swarmforge/scripts/handoffd.bb . --poll-once
→ EOF while reading, expected ) to match ( at [422,1]  (Phase: parse)
```

At `6a2e4aaf6` and `79c5d09b8` the same invocation reaches analysis/runtime
(no parse error).

## Verdict

**The bug IS fixed on current main.** It is **NOT** fixed by BL-636's own
commit (`6a2e4aaf6`): that commit's `handoffd.bb` diff only adds mono-router
priority ranking (`role-mail-row` / `preferred-mono-rotate-role`); the token
`deliver!` does not appear in its patch and the paren fix is absent from that
diff. BL-636's commit message claim is false.

**What actually closed the bug (in order):**

1. **Transient workaround (2026-07-30 QA re-land):** merge conflict resolution
   kept the stale `enqueue-babysitter-wake!` call, which restored paren balance
   without intending to (`backlog/evidence/BL-636-qa-pass-pilot-reland-20260730.md`).

2. **Durable fix on main:** merge `536c16ffb` re-adopted the balanced
   `deliver!` tail from the BL-611 port lineage (`5f9a79511`) — enqueue removed,
   one extra `)` present. This predates BL-902's other handoffd edits and matches
   the explicit fix on unmerged sibling `79c5d09b8`.

**Credit:** BL-636 does not deserve credit. BL-611 productization (`9bc8de790`)
introduced the regression; BL-611 port (`5f9a79511`) and later merge
reconciliation (`536c16ffb`) own the fix.

## Regression lock

`swarmforge/scripts/test/test_handoffd_one_shot_flags_parse.sh` — every
one-shot flag must reach `-main` without a Babashka parse failure.
