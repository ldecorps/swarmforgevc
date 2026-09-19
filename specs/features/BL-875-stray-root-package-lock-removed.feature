Feature: The repo root carries no stray package-lock.json for npm to rewrite

  The repo root has no package.json — `extension/` is the npm root. A tracked,
  contentless `package-lock.json` sits at the root anyway. `npm install` run
  from the root fails ENOENT, but rewrites that lockfile's "name" to the cwd
  basename first, producing an unexplained one-line diff on a tracked file that
  rides along in the next commit.

  Deleting it alone is not enough: npm RECREATES the lockfile when none exists.
  The fix is remove-and-ignore, and the ignore must be root-anchored so that
  extension/package-lock.json — which build_freshness_lib.bb treats as a
  deployed surface — stays tracked.

  Background:
    Given a clean checkout of main

  # BL-875 stray-root-package-lock-01
  Scenario Outline: the root copy is untracked and ignored, the extension copy neither
    When git is asked about "<path>"
    Then git tracking the path is <tracked>
    And git ignoring the path is <ignored>

    Examples:
      | path                        | tracked | ignored |
      | package-lock.json           | no      | yes     |
      | extension/package-lock.json | yes     | no      |

  # BL-875 stray-root-package-lock-02
  Scenario: the extension lockfile is still a recognised deployed surface
    When build_freshness_lib is asked about "extension/package-lock.json"
    Then it reports the path as a deployed surface

  # BL-875 stray-root-package-lock-03
  Scenario: an accidental npm install at the root leaves the working tree clean
    When npm install is run from the repo root
    Then the command fails with ENOENT
    And git status reports no change, tracked or untracked, at the repo root
