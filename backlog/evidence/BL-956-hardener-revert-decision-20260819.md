# BL-956 bounce — revert decision — 2026-08-19

## What the constitution asks
Workflow rules, "A Bounce Must Be Reverted Out Of The Bouncing Branch"
(BL-490/BL-495): a bounce must revert the bounced commit out of the
bouncing role's own branch (`git revert -m 1 <the review merge>`),
except when it is already an ancestor of `main` (then report, don't
revert).

## Why a literal revert was not safe here
The commit I merged from the architect, `a1f4834af` ("Merge architect
BL-956 (bb8cad57d0) into hardener"), is not a single-ticket merge. Its
own parent chain carries BL-953, BL-954, BL-955, BL-956 and BL-957
together — five tickets' worth of promotions, evidence files, and
ticket-state transitions (BL-620/BL-685/BL-949/BL-950 moving into
`backlog/done/M8/`, BL-953/954 moving `active` → `paused`, BL-955/957
being newly minted). Attempted `git revert -m 1 a1f4834af`: the revert
tried to delete BL-955's ticket YAML and topic file outright, move
BL-620/685/949/950 back OUT of `done/`, move BL-953/954 back to
`paused`, and delete three unrelated evidence files
(`BL-954-a-bounce-verifies-its-own-revert-bounce-20260819.md`,
`pipeline-board-parked-and-caption-refinement-20260819.md`,
`specifier-master-checkout-surfaced-20260819.md`) — none of which are
BL-956's content or defective. Confirmed by inspecting `git status`
mid-revert before aborting (`git revert --abort`, clean tree confirmed
after).

Reverting the whole merge commit would have destroyed four-to-five
tickets' worth of legitimate, already-processed work to undo one
ticket's defect — a destructive shortcut the engineering rules already
warn against ("do not use destructive actions as a shortcut... identify
root causes... rather than bypassing safety checks"), and irreversible
in the sense that reconstructing the discarded promotions/evidence by
hand afterward would itself be error-prone.

## Why I judged it safe to leave as-is instead
The rule's own protected invariant is that a bounced commit must not
silently ride forward disguised as approved — the exact BL-536/BL-952
shape (a stale hash or leftover content reaching a later stage looking
clean). That risk applies to FORWARD sends. This bounce is a `git_handoff`
to the **coder** (backward, priority 00, citing the received commit
`bb8cad57d0` per bounce convention) — I am not forwarding my own HEAD
anywhere, and BL-806/BL-950's own review-forward-evidence gate would
refuse a same-commit forward from me regardless. Nothing downstream of
my worktree can currently read BL-956's defective content as
"hardener-approved," because I have not sent it anywhere except back to
its own author with a bounce.

## Disposition
- Bounce sent, recorded in `bounce_history` (`git_handoff` to coder,
  commit `bb8cad57d0`, evidence `BL-956-hardener-bounce-20260819.md`).
- No revert performed; my worktree's HEAD still contains BL-956's
  defective content, but nothing forwards it. The coder's fix, when it
  re-enters through the normal chain, will supersede it here the same
  way BL-952's re-fix superseded its own bounced content earlier this
  session.
- Surfacing this as a `note` to the coordinator rather than silently
  deciding alone, since this is a genuinely novel situation (a bounce
  landing inside a multi-ticket batch merge) the existing rule text
  does not explicitly address.

By hardener.
