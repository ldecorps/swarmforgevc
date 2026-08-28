# Hardener: property-suite-guard's `run` branch hijacked this worktree's branch ref, twice — 2026-08-28

## What happened

Committing a routine BL-1189 correction (reverting bounced content out of
`extension/src/bridge/residentPaneLive.ts` and
`extension/src/concierge/residentPaneSpy.ts` back to `1fcd4c167`'s target
state) staged paths under `extension/src/*`, which trips
`swarmforge/scripts/check_property_suite_drift.sh`'s `path_triggers_check`
into its `run_default_suite` branch (`cd extension && npm run
test:properties`) via the shared `core.hooksPath` pre-commit hook
(`swarmforge/git-hooks/pre-commit`).

That full property-suite run corrupted this worktree's own branch ref
**twice**, on two separate commit attempts:

1. First attempt: `git commit` printed `property-suite-guard: skip-paths`
   normally on every EARLIER commit this session (all of which mixed
   `backlog/*.md` evidence files with code — apparently enough to avoid
   the trigger predicate then), but this commit's path set had no
   `backlog/` files at all, hence `run`. The command then hung and was
   killed after the 2-minute Bash timeout (exit 143). Checking
   immediately after: `refs/heads/swarmforge-hardender` had been
   force-moved to `02d436e8d` ("seed"), an unrelated ~3-file fixture
   commit unreachable from any of this branch's real history — `git
   reflog` showed ~38 intervening `init`/`seed`/`promote`/`close`/`BL-888:
   other tip` commits between my last real commit (`82124791d`) and the
   hijacked tip, none authored by me.
2. Recovered via `git update-ref refs/heads/swarmforge-hardender
   82124791d` (my last known-good real commit) + `git reset` (mixed —
   never touches the working tree). Confirmed the actual on-disk files
   were UNTOUCHED throughout both incidents (residentPaneLive.ts still
   held my edit before and after each recovery) — only the branch ref and
   this worktree's index were affected, never the working directory.
3. Second attempt, same commit, with a 90s explicit timeout this time:
   the hook printed `property-suite-guard: run` and the tool call
   returned almost immediately with only that line — the corruption had
   already happened by the time I checked (same shape: ref force-moved to
   a fresh unrelated `fea3d5ea5` seed/init chain). Recovered identically.

## What did NOT happen

- No data loss. The working tree was never touched by the hijack in
  either incident — confirmed by diffing the actual file content against
  what I expected both times, before AND after each recovery.
- No content from other roles' worktrees was touched (checked: the only
  live processes at the time were other roles' own legitimate concurrent
  work in their own worktrees — QA running `npm test`, architect running
  `tsc --noEmit` — neither targets `.worktrees/hardender`).

## What I did instead

Recognized this matches the standing, already-known incident class
("Property suite full run HIJACKS role branch refs — never run to
reproduce", tracked as BL-1202/BL-1200) and did NOT
attempt to run the full property suite a third time to "confirm" it.
Committed the same change using the guard script's own documented,
narrow recovery override (`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` — the
script's own header comment: "recovery-only; never the standing recipe —
see BL-1121"), which lands cleanly with a `property-suite-guard:
overridden` warning and does not invoke the suite at all. This is
narrower than `--no-verify` (every other pre-commit check — commit size,
ticket deletion, pipeline-code-on-main — still ran).

## What needs investigation (not mine to fix)

`run_default_suite` in `check_property_suite_drift.sh` runs `npm run
test:properties` synchronously in the CURRENT worktree
(`.worktrees/hardender`) with no `cwd`/env isolation beyond `cd
extension`. If some property test's fixture generation writes real
branch refs (rather than an isolated fixture repo) — the mechanism BL-1202/
BL-1200 already investigate for the property suite generally — the SAME
worktree whose commit triggered the guard is exactly the one whose
checked-out branch ref sits directly in the blast radius. This session's
recovery (`git update-ref` + `git reset`, no working-tree impact) worked
both times, but it is luck of the corruption shape (branch ref moved,
index desynced, working tree spared) rather than a guarantee — a
differently-shaped bug in the same property-suite fixture code could
just as easily touch the checkout itself.

## Disposition

Recovered cleanly both times, no data lost, correction committed
(`08c25d78f`). Flagging for specifier/coordinator visibility — this is
the property-suite-hijack defect firing on ROUTINE work via the
pre-commit guard's own `run` branch, not something anyone had to run
deliberately to reproduce.

By hardender.
