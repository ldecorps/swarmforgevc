Feature: BL-1489 The BL-982 single-seat handler compares the fields its scenario names, not the whole roles.tsv line

  BL-982's scenario 04 says every session, worktree, launch script and
  prompt path of a single-seat pack is unchanged from before that slice.
  Its handler proves it by provisioning the same single-seat conf through
  the live launcher and through a pre-change launcher pinned by blob sha,
  then asserting the two roles.tsv files are byte-identical. roles.tsv
  gained a ninth column on 2026-08-30 when reverse git_handoff hops
  arrived, so the live launcher writes forward-only on every row, the
  pinned launcher never will, and the scenario has been red since, saying
  nothing about sessions, worktrees, launch scripts or prompts. This
  feature is that the handler asserts what the scenario claims and nothing
  more, so a column another ticket adds to roles.tsv cannot turn it red.

  # BL-1489 the-bl982-feature-is-green-against-todays-launcher-01
  Scenario: BL-982's feature passes every scenario against the launcher as it stands
    Given the launcher as it stands on the tree, with the reverse-hop column in roles.tsv
    When the BL-982 second-seat feature runs
    Then it passes every scenario

  # BL-1489 a-column-added-to-roles-tsv-does-not-fail-the-single-seat-comparison-02
  Scenario: a column added to roles.tsv by a later slice does not fail the single-seat comparison
    Given a seam launcher that writes one more column on every roles.tsv row
    When BL-982's single-seat comparison runs against the seam
    Then it passes

  # BL-1489 a-changed-session-or-worktree-still-fails-the-comparison-03
  Scenario Outline: a changed <field> still fails the single-seat comparison naming it
    Given a seam launcher that writes a different <field> for the coder row
    When BL-982's single-seat comparison runs against the seam
    Then it fails naming the <field>

    Examples:
      | field    |
      | session  |
      | worktree |
