Feature: BL-1720 A seat dropped mid-shift stays dropped

  The live roster is written at launch into the master roles.tsv and
  sessions.tsv and copied into every worktree. On 2026-09-24 the coder@2
  seat was dropped mid-shift by killing its session and editing the pack.
  The babysitter resurrected it from the start-time roster four minutes
  later. After the master roles.tsv was edited by hand, every worktree's
  copy still listed coder@2, so reverse-hop copies kept being addressed to
  it and stranded in its mailbox. This feature is that one retire
  operation takes a seat out of every roster copy at once, and that
  nothing brings it back or addresses it afterwards.

  Background:
    Given a fixture swarm on a private tmux server whose roster lists coder and coder@2 in the master roles.tsv, sessions.tsv and every worktree copy

  # BL-1720 retiring-a-seat-reaches-every-roster-copy-01
  Scenario: retiring coder@2 removes it from every roster copy
    When coder@2 is retired
    Then no roles.tsv, worktree copy included, and no sessions.tsv lists coder@2
    And coder@2's session is gone

  # BL-1720 a-retired-seat-is-not-resurrected-02
  Scenario: the babysitter's session repair does not bring a retired seat back
    Given coder@2 has been retired
    When the babysitter's sweep runs
    Then no session is created for coder@2

  # BL-1720 a-retired-seat-is-not-addressed-03
  Scenario: a back-all send from a worktree after the retirement addresses no copy to coder@2
    Given coder@2 has been retired
    When the architect's worktree sends a git_handoff forward under back-all
    Then no copy of it is addressed to coder@2
