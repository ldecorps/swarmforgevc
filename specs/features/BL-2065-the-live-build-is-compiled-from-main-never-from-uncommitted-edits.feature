Feature: The live build is compiled from main, never from uncommitted edits
  The front-desk supervisor's stale-build recompile runs `npm run compile`
  in the master checkout's extension/, so it compiles whatever that working
  tree holds and then stamps the build with main's sha. On 2026-10-07 an
  uncommitted hand-made BL-1911 implementation sat in the master checkout
  from 07:41Z; every recompile from 07:46Z put it into the live build, the
  cursor bridges started from 09:31Z ran it, and its secret filter leaked
  (QA note 003900). The live build must be main's committed tree, whatever
  the master working tree holds.

  Background:
    Given a fixture project whose main commit has a compilable extension

  # BL-2065 live-build-from-main-01
  Scenario Outline: a recompile builds main's committed tree, whatever the working tree holds
    Given the fixture's working tree has <change>
    When the supervisor's stale-build recompile runs
    Then the compiled output equals the build of main's committed tree

    Examples:
      | change                                        |
      | no change                                     |
      | an uncommitted edit to a tracked source file  |
      | an untracked source file imported by another  |

  # BL-2065 live-build-from-main-02
  Scenario: the build stamp names the commit the build was compiled from
    Given the fixture's working tree has an uncommitted edit to a tracked source file
    When the supervisor's stale-build recompile runs
    Then the build's BUILD_SHA names main's commit
    And the uncommitted edit is still in the working tree, untouched
