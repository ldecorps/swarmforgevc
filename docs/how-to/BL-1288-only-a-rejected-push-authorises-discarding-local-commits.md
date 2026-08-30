# Only a rejected push authorises discarding local-ahead commits (BL-1288)

[BL-1198](BL-1198-rematch-reset-must-push-before-discarding-local-ahead-commits.md)
put a push in front of every `git reset --hard origin/main` call site, but
`rematch-with-push-first!` only ever checked `:success` on the push result.
Every unsuccessful push — genuine rejection or not — fell through to
`(reset!)`. An unreachable remote, an expired/missing credential, or a
network drop are not divergence, and each of those was answered by
destroying every local-ahead commit. This cost real work: seven resets to
`origin/main` on one day, two of them inside a single specifier turn.

## Fix

`rematch-with-push-first!` (`swarmforge/scripts/master_main_reconcile_lib.bb`)
now classifies the push failure with `push-rejection?` before deciding:

- **Push succeeds** — unchanged: `{:success true :outcome :pushed}`, no reset.
- **Push fails with a recognised non-fast-forward rejection** (`git`'s own
  `! [rejected]` plus `non-fast-forward` or `fetch first` in stderr) — this
  is genuine divergence, the case the reset exists for. `(reset!)` runs
  exactly as before BL-1288; its result is passed through unchanged.
- **Push fails for any other reason** — transport, credential, network, or
  hook-policy failures (including a hook's own `[remote rejected]`, which is
  a policy refusal, not divergence) — the reset is **not** attempted. The
  commits are kept and the result is `{:success false :outcome
  :push-unavailable :error <the push's own error>}`, so the push's own
  reason reaches the caller instead of being replaced by the reset's error
  or by a bare outcome name.

`push-rejection?` fails **closed**: only a recognised rejection authorises
the discard. An unrecognised push failure also keeps the commits, on the
same principle — the list of known transport errors can only ever be
incomplete, and its gaps would otherwise be paid for in destroyed work.

`merge-failure-reason` gained a `:push-unavailable` branch (mirroring
BL-1236's `:verdict-unavailable`) so the daemon's reconcile sweep surfaces a
readable note instead of throwing on a reason it has no case for.

## What did not change

- BL-1198's genuine-divergence path (push rejected → reset) behaves exactly
  as before; it is re-pinned by this ticket's own acceptance scenario 03.
- No retry loop was added. The periodic push-sweep
  ([BL-891](BL-891-master-main-reconcile-sweep.md), retry-on-backoff)
  already owns retrying a failed push; a second retry loop here would
  duplicate what BL-1198 itself avoided. On a non-rejection failure the
  reconcile does nothing this cycle and says why — local stays ahead until
  the sweep or a role pushes.

## Related

- [BL-1198 rematch reset pushes local-ahead main before ever discarding it](BL-1198-rematch-reset-must-push-before-discarding-local-ahead-commits.md)
- [BL-1236 reconcile conflict prediction from git verdict](BL-1236-reconcile-conflict-prediction-from-git-verdict.md)
- [BL-891 master-main reconcile sweep](BL-891-master-main-reconcile-sweep.md)

Acceptance:
`specs/features/BL-1288-only-a-rejected-push-authorises-discarding-local-commits.feature`
