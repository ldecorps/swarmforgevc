Feature: BL-1550 A draft cleanup never unlinks a directory

  extension/test/draftPathUnder.property.test.js (BL-1537 invariant 2)
  draws a draft NAME from fc.string and joins it onto a fresh fixture
  directory. fc.string can draw "." or "..", and path.join(dir, ".") is the
  directory itself, so removeDraftIfPresent is handed a directory: its
  existsSync answers true and its bare unlinkSync throws EISDIR. The file
  is red on the seeds that draw one and green on the rest. This feature is
  that the helper removes only the regular file it was written for, leaves
  a directory in place without throwing, and that the property quantifies
  only over names that are a strict child of the fixture directory, so the
  directory case is a pinned example rather than a lucky or unlucky draw.

  # BL-1550 draft-cleanup-never-unlinks-a-directory-01
  Scenario: the property file is green on the tree as it stands
    When extension/test/draftPathUnder.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1550 draft-cleanup-never-unlinks-a-directory-02
  Scenario Outline: cleanup is idempotent and only ever removes a regular file
    Given <state> at the draft path
    When the draft cleanup runs twice on that path
    Then neither call throws
    And <after>

    Examples:
      | state                       | after                                   |
      | a regular file              | the path no longer exists               |
      | nothing                     | the path no longer exists               |
      | an empty directory          | the directory still exists              |
      | a directory holding a file  | the directory and its file still exist  |
