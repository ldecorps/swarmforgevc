# Merge blocked — check_merge_deletion.sh unexemptable on unticketed INTAKE deletion (2026-09-04)

## What happened
Merging `origin/main f374d49a8e` (post-QA branch sweep notice) into the
documenter worktree. The merge deletes
`backlog/INTAKE-operator-question-1788557930426.md` (archived to
`backlog/archive/` by the specifier's drain, which minted BL-1402 from it
— `f374d49a8e`'s own subject: "Mint BL-1402: ... archive its intake").
`check_merge_deletion.sh` (commit-msg hook, BL-1242/BL-1341) refuses:

```
Error: merge deletes 'backlog/INTAKE-operator-question-1788557930426.md'
((unattributed), introduced at 4239b65b55 on this branch), not named in
the commit message.
```

## Root cause (read the guard's own source this pass)
`ticket_id_for_path()` in `swarmforge/scripts/check_merge_deletion.sh`:

```bash
subject="$(git log -1 --format=%s HEAD -- "$path")"
if [[ -z "$subject" && -n "$MERGE_HEAD_SHA" ]]; then
  subject="$(git log -1 --format=%s "$MERGE_HEAD_SHA" -- "$path")"
fi
```

The MERGE_HEAD fallback only fires when HEAD's subject is **empty**. Here
HEAD's introducing commit (`4239b65b55`, "Operator: file a question as raw
intake for the swarm") has a non-empty subject that simply carries no
`BL-\d+` token — by definition, since a raw intake file is created
*before* any ticket exists to name. The fallback never runs, `id` stays
empty, and the refusal's own exemption path
(`[[ -n "$id" ]] && grep -qiE "\b${id}\b" <<<"$message"`) can never
trigger when `id` is empty — no commit message, however worded, can
satisfy it. Meanwhile the incoming branch's own history for this exact
path has a properly-attributed deletion commit
(`f374d49a8e`, names BL-1402) that the current lookup never consults,
because it only re-tries MERGE_HEAD when HEAD's subject is blank, not
when HEAD's subject merely lacks a ticket id.

## Why this isn't a documenter fix
This is a shell guard's attribution logic, not documentation — outside
Article 1.7's "factual doc fix" exemption. Reported per workflow rules
("Never Blind-Forward A Bounce You Cannot Fix" / standing guidance to
surface blocking infrastructure rather than bypass a hook) rather than
edited or skipped (`--no-verify` is never used per constitution
guardrails).

## Current state
The merge is staged (index holds the correct merged tree — the archive
move is present, nothing lost) but **not committed**; `MERGE_HEAD` is
still set in this worktree. Left as-is pending resolution, rather than
aborted, so no work is discarded and no false-clean state is created.

## Suggested fix (not mine to make)
Either: (a) also fall back to `MERGE_HEAD`'s subject when HEAD's subject
carries no ticket id (not just when empty), or (b) exempt
`backlog/INTAKE-*.md` deletions the same way `is_ticket_yaml_path`
exempts `backlog/{paused,active,done}/*.yaml` — a raw intake's own
deletion-by-drain is a normal, expected lifecycle event once it is
minted, and its introducing commit can never carry the ticket id that
names it.
