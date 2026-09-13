# mutation-stamp: sha256=6c8b5b62fbc33f6fb2418575ff829685eab809b0ca69b3d54b478c8ea154e714
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-13T17:13:32.051524817Z","feature_name":"BL-1489 The BL-982 single-seat handler compares the fields its scenario names, not the whole roles.tsv line","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1489-the-bl982-single-seat-handler-compares-the-fields-it-names.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":2,"name":"a changed <field> still fails the single-seat comparison naming it","scenario_hash":"8d6dfacc438fe78c97974609aa04e07e9f5f42da35636b49ba9dbcfc524c22cf","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-13T17:13:32.051524817Z"}]}
# acceptance-mutation-manifest-end

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
