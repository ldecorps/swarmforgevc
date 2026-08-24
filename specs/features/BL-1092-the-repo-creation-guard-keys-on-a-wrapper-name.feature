# mutation-stamp: sha256=d2d535f2bbd6f9f8ea676b3590dc8ca3f637332424fa1c74f2867749a69041bf
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T14:22:24.467091806Z","feature_name":"The repo-creation guard recognises a creation by what it does","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1092-the-repo-creation-guard-keys-on-a-wrapper-name.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A creation is recognised by what the helper spawns, never by its name","scenario_hash":"2a7bf5bde25b784732306fedc8378565d01bb92e8d1acc23b90fb5035e7b79c6","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:22:24.467091806Z"},{"index":1,"name":"Correct code stays unflagged","scenario_hash":"56dcd893d8829dd39f59292f0a42291abb907b2ae90b712da6189149e1cd1ea1","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:22:24.467091806Z"}]}
# acceptance-mutation-manifest-end

Feature: The repo-creation guard recognises a creation by what it does

  BL-1039's guard keeps unit-lane tests off real `git init` by scanning the
  corpus. Its wrapper alternation is spelled `git(`, so it sees a creation
  only when the helper happens to carry that name.

  The narrowness is not an oversight: widening it naively matches the shared
  fixture helper's own internal spawn, and a guard that reddens correct code
  is one everybody learns to wave through. So the guard must get MORE
  precise, not merely more permissive.

  # BL-1092 repo-creation-by-behaviour-01
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

  # BL-1092 repo-creation-by-behaviour-02
  Scenario Outline: Correct code stays unflagged
    Given a test file whose init call is <situation>
    When the repo-creation guard scans the file
    Then the file is not flagged as creating a repository

    Examples:
      | situation                                           |
      | a whole-line string literal describing file content |
      | the shared fixture helper's own internal spawn      |
      | accompanied by a recorded exemption reason          |

  # BL-1092 repo-creation-by-behaviour-03
  Scenario: The live corpus gains no new violations
    Given the unit-lane test corpus as it stands
    When the repo-creation guard scans every test file
    Then the reported violations are exactly those reported before the change
