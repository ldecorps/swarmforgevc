Feature: BL-1902 Reverse-hop copies and QA's merge-up broadcast retire

  Before BL-1871, every role merged each parcel into its own long-lived
  branch, so two kinds of handoff kept those branches in step: reverse-hop
  copies (a non-forwarding copy of each forward to earlier roles) and QA's
  merge-up broadcast to five roles on every approval. A role on parcel
  lines merges neither, so both are now handoffs a role takes up only to
  complete. The live pack still declares the cleaner back-one and the
  architect back-all, and QA still broadcasts a merge-up for every land.
  Both retire, so a parcel's forward and QA's approval wake only the role
  that acts.

  # BL-1902 the-live-pack-declares-no-reverse-hop-01
  Scenario: the live pack declares no reverse hop for any window
    When the window lines of swarmforge/packs/full-forge.conf are read
    Then no window declares back-one or back-all
    And the pack still declares its 8 role windows

  # BL-1902 no-merge-up-ceremony-02
  Scenario: the ceremony handoffs compose no merge-up broadcast, and the coordinator's note is unchanged
    When the ceremony handoff library lists its ceremonies
    Then it lists no merge-up ceremony
    And the bookkeep ceremony still composes the coordinator's note for a ticket and commit
