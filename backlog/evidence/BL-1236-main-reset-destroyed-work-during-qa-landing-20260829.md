# BL-1236 main-reset destroyed local `main` work twice during QA landing — 20260829

## What happened

QA (me) landed two approved tickets in sequence this pass:
1. BL-1262 — pushed `8450de59eb` to `origin/main`.
2. BL-581 — pushed `ba4d65fd4a` to `origin/main`.

Each push advanced `origin/main` while local `main` (the shared master
checkout) had accumulated ahead-of-origin commits, and the BL-1236
`master-main-reconcile` reset (still unshipped as of this writing — see
[[main-reset-to-origin-destroys-local-commits]]) fired both times,
destroying local `main`'s ahead state and resetting it to whatever I had
just pushed. Confirmed via `git log -g main`:

```
ba4d65fd4 main@{0} reset: moving to origin/main      <- 2nd reset, to my BL-581 push
03b92b8dc main@{1} commit: BL topic record for BL-1268
...
852a65dc5 main@{25} commit: Close BL-1262: move to done
8450de59e main@{26} reset: moving to origin/main      <- 1st reset, to my BL-1262 push
```

I did not touch local `main`'s ref myself at any point — both pushes were
the normal `git push origin HEAD:refs/heads/main` from my own
`swarmforge-QA` branch (Article 1.8's landing flow, per
[[qa-main-checkout-has-live-uncommitted-work]]). The reset is the
standing BL-1236 daemon defect firing on ordinary QA landing traffic, not
something this landing did wrong.

## What was destroyed (all still recoverable — nothing GC'd)

Two overlapping segments, captured by ONE linear rescue ref (the coordinator
had already redone most of the first segment's work before the second reset
hit, so the second segment is the complete, de-duplicated, latest state):

- **1st reset** (to `8450de59e`) destroyed: `Close BL-1262: move to done`
  (`852a65dc5`), `BL topic record for BL-1262` (`268ad6a41`), `Remove stale
  paused/ duplicates for BL-1222 and BL-581` (`c6debbd03`), a BL-1273 spec +
  approval + note (`bdce513aa`/`718dc3866`/`625fbb8ca`), a BL-1267/1268
  size-envelope-gate discharge (`d74f44780`), and a BL-603 spec + route-to-coder
  (`2a43fdce0`/`ba5f492ee`).
- **2nd reset** (to `ba4d65fd4a`) destroyed: redone copies of most of the
  above (recommitted after the 1st reset), PLUS newly-arrived work that
  never existed before the 1st reset: `Promote BL-1267`/`Promote BL-1268`
  (`63f69f5bd`/`557b355d2`), `BL topic record for BL-1267`/`BL-1268`
  (`fe50addd8`/`03b92b8dc`), and a cherry-picked operator directive
  reprioritizing the best-of-breed-swarm epic (BL-1180/1182/1183/1172/667,
  `4e040765b`), plus retirements of BL-1230/1228/1211 as
  shipped-and-QA-approved (`e1cb61b11`/`7f750c72c`/`d4ee9e86e`).

## Recovery already staged (safe, no data loss)

`git branch -f rescue/main-before-recovery-20260829 03b92b8dc` — one ref,
captures the full chain back through both reset points (verified:
`8450de59e` and `852a65dc5` are both ancestors of `03b92b8dc`). Nothing
GC'd or pruned.

**Merge dry-run already verified clean**: `git merge-tree --write-tree
ba4d65fd4a rescue/main-before-recovery-20260829` exits 0 with a single
tree OID, no conflict markers — a real `git merge --no-ff
rescue/main-before-recovery-20260829` onto current `main` should apply
without conflicts.

## Why QA is not doing the merge itself

Per [[qa-main-checkout-has-live-uncommitted-work]]: QA must not
`git merge`/`checkout` inside the master checkout, and moving `main`'s ref
from another worktree while the master checkout has live/uncommitted state
risks the same entanglement even without `cd`-ing there. Read-only check
just now: the master checkout currently has one untracked file
(`swarmforge/packs/qwen-anthropic-forge.conf`) — low risk today, but this
recovery also requires judgment on ticket-pool state (the reprioritization,
the retirements, the BL-1262 close) that belongs to whoever is already
tracking that context, not QA reconstructing it from a diff.

## Ask

**Specifier/coordinator**: from the master checkout, `git merge --no-ff
rescue/main-before-recovery-20260829` (verified clean above), resolve if
anything unexpected surfaces, commit, then send QA the resulting commit
hash. **QA will push it to `origin/main` immediately** in the same turn
(per the durability rule: recovery without an immediate push is a
countdown to the next reset, not a fix).

Root cause remains **BL-1236** (`merge-tree-reports-conflict?` prose-false-positive),
still unshipped. Not re-minting; this file documents another occurrence.

By QA.
