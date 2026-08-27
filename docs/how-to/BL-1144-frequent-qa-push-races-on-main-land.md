# Reduce frequent QA push-race / tip-purity rematch storms (BL-1144)

Rematch recovery (BL-1130 / BL-1131 / BL-1138 / BL-1141) already lands residual
races without paging a human. The remaining tax is **frequency**: concurrent
land/close publishers advance `origin/main` while a long QA gate holds a tip
on a stale base → tip-purity bounce cascades.

## Controls (both required)

1. **Publish-time tip rematch is authoritative**  
   Gate-time purity is advisory. Immediately before the land push, fetch and
   rematch so the tip contains current `origin/main`. Residual races retry
   within `publish-rematch-max-attempts` (2), then **wait on the land lock** —
   never an unbounded mid-gate rematch loop.

2. **Serialize land/close publishers**  
   Directory lock: `.swarmforge/land-main.publish.lock`. A second publisher
   rematches **once** at the lock edge, then waits. Peer-held lock → wait,
   do not bounce.

## Operator / QA discipline

Prefer:

```bash
swarmforge/scripts/land_main_publish.sh <root> --acquire-lock
# rematch tip-pure onto origin/main if decide-only says :rematch-then-push
swarmforge/scripts/land_main_publish.sh <root> --decide-only
git push origin HEAD:main   # never force-push; tip must contain origin/main
swarmforge/scripts/land_main_publish.sh <root> --release-lock
```

Policy: `master_main_reconcile_lib.bb` (`publish-time-purity-action`,
`land-close-publisher-admission`, `contention-publish-next`). Tip purity
remains mandatory; residual recovery stays rematch lander/bookkeeping.

## Related

- [BL-1131 rematch-then-FF](BL-1131-ticket-land-without-operator-absorb-merge.md)
- [BL-1130 clean-refuse absorb](BL-1130-land-on-main-without-external-conflict-resolution.md)
