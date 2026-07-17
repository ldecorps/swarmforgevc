# Upstream Deviations Log

This is the review log `swarmforge/constitution/articles/local-engineering.prompt`
(Architecture Rule 2) refers to: a human-readable record of each upstream
drift-watch review and the adopt / skip / already-have decision made for it, so a
deliberate divergence in this heavily-diverged fork is documented once rather than
re-litigated on every future check.

## Mechanism (BL-477)

- `upstream-watch.json` (repo root) records the last-**reviewed** commit SHA per
  watched upstream repo/branch — the baseline "we have looked at everything up to
  here."
- `swarmforge/scripts/upstream_drift_check.bb` reads that baseline, `git ls-remote`s
  each watched repo, and reports any branch whose live head has advanced past the
  recorded SHA, or any branch present upstream with no entry in the watch file at
  all. It is strictly read-only — it never fetches into the working tree, never
  rewrites the watch file, and never bumps an install pin.
- Advancing a watch SHA (recording "reviewed up to here") is always a human
  decision, made by editing `upstream-watch.json` directly — exactly like bumping
  an install pin in `swarmforge.lock.json`, and never something the check script
  does itself.
- This fork has **no common git ancestor** with `unclebob/swarm-forge` (verified
  2026-07-17: `git merge-base HEAD ub/main` = none), so adopting anything found by
  a drift review is always a manual, deliberate reimplementation reviewed by a
  human — never a git merge/cherry-pick the tooling performs.

## Review log

### 2026-07-17 — baseline review (BL-477)

The mechanism this file and `upstream-watch.json` implement did not exist before
this review; this entry seeds the baseline rather than recording a *change* since
a prior review.

| Repo | Branch | Reviewed SHA | Decision |
|------|--------|-------------|----------|
| unclebob/swarm-forge | main | `9acd54d2239fef7e41ddacd8fd30dfb0e69672fe` | Baseline seeded. No common ancestor with this fork — any future adoption is a manual, human-reviewed reimplementation, never a git merge/cherry-pick. |
| unclebob/swarm-forge | adversaries | `7aa2f3a2691ed92e26a11be4481d7d5c8e2ff859` | Baseline seeded. One novel element found on this branch during the 2026-07-17 survey; dispositioned separately (BL-478 evaluates it). |
| unclebob/Acceptance-Pipeline-Specification | main | `accaa33d503340c56513ef387258f8da929ba902` | Baseline seeded. Already have it — this SHA equals `swarmforge.lock.json`'s current APS install pin. |

**Not tracked in `upstream-watch.json`:** APS's `codex/bb-tools-equivalence` branch
(observed 2026-07-17 at an abbreviated `3a1d7b06...`) is not reachable from APS
`main` and is therefore not adoptable via a simple pin bump either way. It is
recorded here as context for the next full review, not added as a tracked branch
pending a closer look at what it actually contains.
