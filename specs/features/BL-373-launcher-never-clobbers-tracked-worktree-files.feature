Feature: The launcher never overwrites git-tracked files in a role worktree

# BL-373: the "phantom revert" mechanism, ROOT-CAUSED (6 occurrences on 2026-07-14 alone, across
# four worktrees). `sync_worktree_scripts()` in swarmforge/scripts/swarmforge.sh runs on EVERY
# launch and does an unconditional `cp -R` of the LAUNCHING checkout's swarmforge/scripts/ and
# swarmforge/profiles/ over each role worktree's copy of those same paths. In this self-hosted repo
# those paths are GIT-TRACKED (only `.swarmforge/` is gitignored), so the copy silently overwrites
# tracked branch content with master's bytes, outside git entirely. Any script change merged onto a
# role branch but not yet landed on main is therefore reverted in the working tree at every relaunch.
# This explains every observation: the diff is byte-identical to the pre-ticket commit (master's
# content IS the pre-ticket content); it never appears in the master checkout (the sync loop skips
# the working dir); untracked new files survive (cp -R only overwrites what the source has); and it
# recurs on each relaunch.
#
# The sync is not gratuitous — a foreign TARGET repo does not carry swarmforge/ at all and genuinely
# needs the scripts copied in. The invariant that separates the two cases: never overwrite a file the
# worktree's own git tracks. The runtime-state copies into the gitignored `.swarmforge/` are correct
# and must keep working.

Background:
  Given a swarm whose role worktrees are checkouts of the target repository
  And every role worktree starts with a clean working tree

# BL-373 launcher-never-clobbers-tracked-worktree-files-01
Scenario Outline: Launching a swarm does not modify a git-tracked path in a role worktree
  Given the target repository git-tracks "<tracked_path>"
  When the swarm is launched
  Then "<tracked_path>" in every role worktree is unmodified
  And every role worktree reports no uncommitted changes

  Examples:
    | tracked_path        |
    | swarmforge/scripts  |
    | swarmforge/profiles |

# BL-373 launcher-never-clobbers-tracked-worktree-files-02
Scenario: Work merged on a role branch but not yet on main survives a relaunch
  Given the target repository git-tracks the swarm scripts
  And a role branch has merged a script change that main does not yet have
  When the swarm is relaunched
  Then that role worktree still contains the change
  And every role worktree reports no uncommitted changes

# BL-373 launcher-never-clobbers-tracked-worktree-files-03
Scenario: A target repository that does not track the swarm scripts still receives them
  Given the target repository does not git-track the swarm scripts
  And a role worktree has no swarm scripts of its own
  When the swarm is launched
  Then that role worktree has the swarm scripts available to run

# BL-373 launcher-never-clobbers-tracked-worktree-files-04
Scenario: Local runtime state is still delivered to every role worktree
  Given the target repository git-tracks the swarm scripts
  When the swarm is launched
  Then every role worktree has the current session, role, and tmux-socket state
  And every role worktree reports no uncommitted changes

# BL-373 launcher-never-clobbers-tracked-worktree-files-05
Scenario: A launch that declines to overwrite a tracked path says so
  Given the target repository git-tracks the swarm scripts
  When the swarm is launched
  Then the launcher reports that it left the tracked paths to git
