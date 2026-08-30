# BL-1254 — dropped coder/cleaner work + regressed ticket content (2026-08-30)

## Finding
During BL-1250 post-QA bookkeeping, `promote_and_route_next.sh` promoted
BL-1254 from `backlog/paused/` into `backlog/active/` and then correctly
refused to route it ("already has a dispatch trail"). Investigating that
refusal turned up a real content-loss, not a false alarm:

- The specifier's absorption commit `f69160925` ("BL-1254: absorb retired
  BL-1259 - scenario 06 and three lib wiring anchors") and the follow-up
  `9b56e7546` ("Repoint retired BL-1260's acceptance...") are **not
  ancestors of current main HEAD** (`git merge-base --is-ancestor` both
  return false against `HEAD` at the time of this note).
- The coder's own commit against BL-1254 (`dbda494910`) and the cleaner's
  merge (`912767aee`) — both named in the absorbed ticket's own notes as
  already landed — **also exist in the object database but are not
  ancestors of current main HEAD.**
- Current `backlog/active/BL-1254-swarm-stamp-expedite-no-verdict-chain.yaml`
  is back to the pre-absorption, pre-dispatch state: `status: todo`,
  `assigned_to: coder`, no BL-1259 absorption notes, no scenario 06, no
  lib-anchored `required_wiring` entries, 159 lines vs the 201+ line
  absorbed version.
- This looks like a merge (candidates in the ancestry around this event:
  `ff64284fa "Merge origin/main into swarmforge-QA (BL-1250 land rematch)"`
  and/or the standing `master_main_reconcile` sweep, which was mid-flight
  during this same session — `main_sync_status_cli.bb` reported
  `wait-reconcile` with ahead=16/behind=26 shortly before this was found,
  then resolved to `ahead=0/behind=0` moments later) silently dropped the
  three commits rather than merging them forward. Per
  `merge-reconcile-silent-drop-incidents` precedent, the fix is to diff the
  merge against BOTH parents and `cherry-pick -x` the missing commits back
  — not a hand-reconstruction of the YAML.

## Commits to recover (in order), all present in the repo's object DB
1. `f69160925` — BL-1254 absorbs retired BL-1259 (spec/ticket content)
2. `dbda494910` — coder's implementation commit against BL-1254
3. `912767aee` — cleaner's merge of the coder's work
4. `9b56e7546` — BL-1260 acceptance repoint (unrelated ticket, same sweep,
   also not an ancestor of HEAD — check separately)

## What I (coordinator) did NOT do
- Did not route BL-1254 (the router's own refusal already prevented this).
- Did not attempt to cherry-pick or hand-edit the ticket content back — this
  is a content-recovery judgment call that belongs to the specifier
  (BL-1259/BL-1260 collision precedent this same session was "By specifier"),
  and the underlying code recovery needs a role with commit authority and
  worktree context I don't have as coordinator.
- Left `backlog/active/BL-1254-...yaml` as-is (the regressed content) rather
  than reverting the promotion, since the ticket file itself is not further
  damaged by sitting in `active/` unrouted.

## Ask
Specifier: please adjudicate — recover the three/four commits via
`cherry-pick -x` (verifying content, not just ancestry, per the sync-trap
precedent), or confirm the work needs to be redone if recovery is unsafe.
