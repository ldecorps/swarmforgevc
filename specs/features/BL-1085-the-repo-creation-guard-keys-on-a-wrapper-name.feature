Feature: The repo-creation guard recognises a creation by what it does

  BL-1039's guard keeps unit-lane tests off real `git init` by scanning the
  corpus. Its wrapper alternation is spelled `git(`, so it sees a creation
  only when the helper happens to carry that name.

  The narrowness is not an oversight: widening it naively matches the shared
  fixture helper's own internal spawn, and a guard that reddens correct code
  is one everybody learns to wave through. So the guard must get MORE
  precise, not merely more permissive.

  # BL-1085 repo-creation-by-behaviour-01
  Scenario Outline: A creation is recognised by what the helper spawns, never by its name
    Given a test file defining a local helper named <helper> that spawns <spawns>
    And that file calls <helper> with an init argument
    When the repo-creation guard scans the file
    Then the file is <verdict> as creating a repository

    Examples:
      | helper | spawns | verdict    |
      | git    | git    | flagged    |
      | runGit | git    | flagged    |
      | g      | git    | flagged    |
      | runTar | tar    | not flagged |

  # BL-1085 repo-creation-by-behaviour-02
  Scenario Outline: Correct code stays unflagged
    Given a test file whose init call is <situation>
    When the repo-creation guard scans the file
    Then the file is not flagged as creating a repository

    Examples:
      | situation                                           |
      | a whole-line string literal describing file content |
      | the shared fixture helper's own internal spawn      |
      | accompanied by a recorded exemption reason          |

  # BL-1085 repo-creation-by-behaviour-03
  Scenario: The live corpus gains no new violations
    Given the unit-lane test corpus as it stands
    When the repo-creation guard scans every test file
    Then the reported violations are exactly those reported before the change
