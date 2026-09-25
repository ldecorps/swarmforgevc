Feature: BL-1729 A property-lane repository walk never reads the checkout's runtime state

  Two property files check that a guard function is defined in exactly one
  file repo-wide: bl874PortableTimeInvariants and tempDirTrapGuard. Each
  walks the whole repository root through the shared property-lane tree
  walk (BL-1443) and reads every .js file into memory. The walk skips
  .worktrees/ and node_modules/, but not the gitignored runtime directory
  .swarmforge/. On the shared main checkout that directory carries 475 MB of
  bundled .js (the operator's VS Code CLI server installs). So, run alone on
  main, the two files peak at 894 MB and 1778 MB. Under the full lane's
  640 MB per-worker cap, both workers die, and the pre-commit property guard
  refuses every extension/src commit on main. A role worktree's .swarmforge/
  carries none of it, which is why the lane is green there. This feature is
  that the walk never opens the root's runtime directories. What it reads,
  and the heap it takes, are then the same on every checkout of one commit.

  Background:
    Given a fixture git repository whose .gitignore lists .swarmforge/ and tmp/
    And a tracked .js file in a nested source directory that defines the guard function

  # BL-1729 a-runtime-directory-is-never-opened-01
  Scenario Outline: a .js file under a runtime directory is never opened by the walk
    Given the runtime directory <dir> at the repository root holds a .js file that also defines the guard function
    When the shared property-lane tree walk reads the .js files under the repository root
    Then the file under <dir> is never opened
    And the only file found defining the guard function is the tracked one

    Examples:
      | dir          |
      | .swarmforge/ |
      | tmp/         |

  # BL-1729 a-second-tracked-definition-is-still-found-02
  Scenario: a second tracked definition is still found
    Given a second tracked .js file in another source directory also defines the guard function
    When the shared property-lane tree walk reads the .js files under the repository root
    Then both tracked files are found defining the guard function
