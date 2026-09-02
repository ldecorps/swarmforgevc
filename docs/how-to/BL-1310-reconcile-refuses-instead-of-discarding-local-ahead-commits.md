# The reconcile refuses instead of discarding local-ahead commits (BL-1310)

[BL-1198](BL-1198-rematch-reset-must-push-before-discarding-local-ahead-commits.md),
[BL-1214](BL-1214-ff-absorb-attempts-real-merge-before-reset.md),
[BL-1236](BL-1236-reconcile-conflict-prediction-from-git-verdict.md), and
[BL-1288](BL-1288-only-a-rejected-push-authorises-discarding-local-commits.md)
each narrowed **when** the master-main reconcile may fall through to
`git reset --hard origin/main`. None of them changed what happens to the
commits once it does: every local-ahead commit was discarded outright, with
no branch, tag, or listing anywhere — recoverable only by luck, from the
reflog, before `git gc` collects the now-unreachable objects. On
2026-08-31 this destroyed seven commits of specifier work, including a
whole ticket mint and an accepted `rule_proposal`; they were recovered by
an idle specifier reading the reflog an hour later.

Human ruling (approved): **never discard local-ahead commits — refuse and
surface, a human resolves it.**

## Fix

`refuse-reset-if-local-ahead!` (`swarmforge/scripts/master_main_reconcile_lib.bb`)
now wraps every one of the three raw `git reset --hard origin/main` call
sites (`handoffd.bb`, `swarm_heal.bb`, `post_hotfix_merge_origin.bb`). It
reads local main's ahead-count fresh, right before the reset would fire,
and authorises the reset **only when that count is a known zero**:

- **`ahead = 0`** — unchanged: the raw reset runs, its result passed through
  verbatim. This is the case none of the earlier tickets needed to touch —
  there is nothing local-only to lose.
- **`ahead > 0`** — refused. The reset never runs. Result is
  `{:success false :outcome :local-ahead-refused :ahead <n> :error "BL-1310: ..."}`,
  surfaced in the daemon log so an operator who never opens a reflog can
  tell from that line alone why nothing moved.
- **`ahead` undeterminable (nil)** — also refused, on the same principle
  BL-1236's `:verdict-unavailable` and BL-1288's `:push-unavailable`
  already use: an unknown count never reads as "safe to reset."

This **supersedes** the "genuine rejection → reset proceeds" case described
in BL-1198's and BL-1288's own how-to docs: a rejected push used to
authorise a reset outright whenever the divergence was genuine. It still
does, but only when the rejection turns out to carry `ahead = 0` — any
`ahead > 0` divergence now refuses instead, regardless of push outcome.

## What did not change

- The push-first attempt (BL-1198) and its failure classification
  (BL-1288) still run exactly as before this ticket — `refuse-reset-if-
  local-ahead!` sits **after** them, gating only the reset call itself.
- The `:ff-absorb` real-merge path (BL-1214) and conflict-prediction
  refusal (BL-1236) are unchanged; a merge that lands losslessly never
  reaches the reset at all.
- No replay of the refused commits was added — this slice makes the loss
  recoverable/refused, not automatically resolved. See the ticket's own
  `notes:` for why a replay is a separate, riskier slice.

## Related

- [BL-1198 rematch reset must push before discarding local-ahead commits](BL-1198-rematch-reset-must-push-before-discarding-local-ahead-commits.md) (superseded on the genuine-rejection case above)
- [BL-1288 only a rejected push authorises discarding local commits](BL-1288-only-a-rejected-push-authorises-discarding-local-commits.md) (superseded on the genuine-rejection case above)
- [BL-1214 ff-absorb attempts real merge before reset](BL-1214-ff-absorb-attempts-real-merge-before-reset.md)
- [BL-1236 reconcile conflict prediction from git verdict](BL-1236-reconcile-conflict-prediction-from-git-verdict.md)
- [BL-891 master-main reconcile sweep](BL-891-master-main-reconcile-sweep.md)

Acceptance:
`specs/features/BL-1310-reconcile-never-discards-a-commit-it-cannot-name.feature`.
