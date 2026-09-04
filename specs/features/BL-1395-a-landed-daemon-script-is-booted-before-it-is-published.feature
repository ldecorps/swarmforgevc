# mutation-stamp: sha256=7991e6f23a1fb46e96a103fac457cee76db313d390d14d7ec08e8a2b8a31a483
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-04T20:27:12.868335403Z","feature_name":"BL-1395 A landed daemon script is booted before it is published","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1395-a-landed-daemon-script-is-booted-before-it-is-published.feature","background_hash":"de06caa9b194715740c50cb39257c50890c936280af9a42103611bd5ea0f3b15","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a script that fails analysis on the tree is refused naming the symbol","scenario_hash":"06548f2f6d05f28f504b5e9334e1dcb344982b1313d9e61414adf7e967393fd0","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-04T20:27:12.868335403Z"},{"index":2,"name":"handoffd from the tree under test is booted against a fixture root","scenario_hash":"a545dec6dfcf87e392bf91e0e1b55840be337b434ddb6335fc291c51970827a6","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-04T20:27:12.868335403Z"},{"index":4,"name":"the commit guards and the land replay both refuse a broken script","scenario_hash":"1a53718bab80331ae9b3eecd9fe976ea033256881e9ffe52a19cba899052dd50","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-04T20:27:12.868335403Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1395 A landed daemon script is booted before it is published

  Babashka analyses every definition eagerly when a file loads, so a script
  that names a symbol nothing has defined yet fails before any function
  runs. Three times in eight days such a script reached main unseen, the
  last time as the live daemon, which then crash-looped while the land's
  verification had been three greps. This feature is that every changed
  Babashka script is loaded against the tree under test before a commit or
  a land may publish it, that the daemon itself is booted from that tree,
  and that the daemon's own entry point no longer runs on load.

  Background:
    Given a fixture tree with the swarmforge scripts and a bare origin

  # BL-1395 a-forward-reference-is-refused-01
  Scenario Outline: a script that fails analysis on the tree is refused naming the symbol
    Given a Babashka library on the tree whose body has <defect>
    When the script load guard examines the tree
    Then the guard refuses
    And its output names the file, the line and the unresolved symbol

    Examples:
      | defect                                                   |
      | a call to a function defined later in the same file      |
      | a runtime require inside a function body                 |
      | a call to a function defined nowhere                     |

  # BL-1395 a-loading-script-passes-02
  Scenario: a script whose definitions are all in order passes
    Given a Babashka library on the tree whose definitions are all in order
    When the script load guard examines the tree
    Then the guard passes

  # BL-1395 the-daemon-is-booted-not-just-analysed-03
  Scenario Outline: handoffd from the tree under test is booted against a fixture root
    Given handoffd on the tree is in <shape>
    When the script load guard boots the daemon against a fixture root
    Then the guard <verdict> within its bound

    Examples:
      | shape                                              | verdict               |
      | the landed shape with an undefined read-json       | refuses naming handoffd |
      | the QA tip shape with the block after its callee   | sees one heartbeat and passes |

  # BL-1395 the-verdict-comes-from-the-tree-not-the-checker-04
  Scenario: a script that loads in the checker's worktree but not on the tree is refused
    Given a Babashka library that names a symbol defined only in the checker's worktree
    When the script load guard examines the tree
    Then the guard refuses

  # BL-1395 both-paths-ask-the-question-05
  Scenario Outline: the commit guards and the land replay both refuse a broken script
    Given a change on the tree to a Babashka library that fails analysis
    When <path> runs on that tree
    Then it refuses naming the library
    And every other guard's status is still reported

    Examples:
      | path              |
      | the commit guards |
      | the land replay   |

  # BL-1395 load-file-no-longer-starts-the-daemon-06
  Scenario: loading handoffd.bb as a file analyses it without starting a daemon
    Given handoffd.bb on the tree with its entry point guarded
    When handoffd.bb is loaded as a file with no arguments
    Then no daemon process starts
    And the load completes with no error
