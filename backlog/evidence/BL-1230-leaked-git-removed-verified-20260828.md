# BL-1230 — live backlog/.git removal verified (human ask #1, 2026-08-28 briefing)

**When:** 2026-08-28 ~07:09 BST via Cursor (acting on morning briefing asks).
**Ticket:** BL-1230 (report-only guard; human removes leaks).

## Result

`backlog/.git` is **absent**. Verified:

```
test ! -e backlog/.git          → OK
cd backlog && git rev-parse --show-toplevel
  → /home/carillon/swarmforgevc   (parent repo, not a nested root)
cd backlog && git rev-parse --git-dir
  → /home/carillon/swarmforgevc/.git
git ls-files backlog | wc -l   → 4881 (parent tracking intact)
```

Ticket `human_ruling` already recorded same-day human removal; this note
re-checks after the briefing ask so the coordinator can clear ask #1.
