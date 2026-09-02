Feature: rematching local main onto origin/main attempts a push before discarding any local-ahead commit

  # BL-1198 (epic swarm-reliability). 2026-08-27: the specifier's own commit
  # 18a0dad4e (BL-428 SG1 acceptance fix) was made on local main, never
  # pushed, then silently dropped ~54 minutes later by a "rematch bookkeeping"
  # `git reset --hard origin/main` (BL-1131/1138/1141, three independent call
  # sites: handoffd.bb's master-main-rematch-onto-origin!, swarm_heal.bb's
  # inline rematch, post_hotfix_merge_origin.bb's rematch-onto-origin!) —
  # confirmed via reflog (backlog/evidence/BL-428-sg1-fix-dropped-by-origin-
  # reset-20260827.md), recovered only because the commit was still dangling
  # and findable there. That reset path exists deliberately for a real case
  # (local main ahead with synthetic/disposable bookkeeping commits that
  # collided with origin) but never distinguishes that case from a genuine,
  # not-yet-pushed authored commit — and never even tries the cheap, safe
  # alternative first: push local main to origin. When origin has not
  # diverged, that push is a plain fast-forward and nothing needs discarding
  # at all; only when the push itself is rejected (genuine divergence) does
  # today's reset-based recovery still make sense, unchanged.

  Background:
    Given local main holds one or more commits not yet present on origin/main

  # BL-1198 pushable-ahead-commits-survive-01
  Scenario: A local-ahead commit that origin has not diverged from is pushed, not discarded
    Given origin/main has not diverged from local main's history
    When the rematch path runs
    Then it pushes local main to origin/main before any reset is attempted
    And the local-ahead commit is present on origin/main afterward
    And no reset --hard is performed

  # BL-1198 genuinely-colliding-ahead-still-recovers-02
  Scenario: A local-ahead commit that collides with origin is kept after a rejected push
    Given origin/main has diverged such that pushing local main is rejected
    When the rematch path runs
    Then it attempts the push first
    And local main is left with the local-ahead commit intact
    And no reset --hard is performed
