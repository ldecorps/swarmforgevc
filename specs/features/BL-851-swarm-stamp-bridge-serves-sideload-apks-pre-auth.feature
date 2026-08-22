# mutation-stamp: sha256=53682c1dcc89d0b1249d08bc8293718e2d3d1455dac59bc5bbcf93b85747f2ab
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-08T23:21:19.544668Z","feature_name":"The one route that skips the bearer check serves published APKs and nothing else","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-851-swarm-stamp-bridge-serves-sideload-apks-pre-auth.feature","background_hash":"05893dd39ecd9b38effbbff348f28f9fd6604c0781041158faa4111bd37a1597","implementation_hash":"unknown","scenarios":[{"index":2,"name":"nothing outside the public directory is ever served","scenario_hash":"f1314f7ebab4fb23342d6ebd0fc860330fa9e832ed1ecc16dc6c9e3f69715454","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-08T23:21:13.152195Z"}]}
# acceptance-mutation-manifest-end

Feature: The one route that skips the bearer check serves published APKs and nothing else
  DRAFT — parked per BL-233. Promote to a live `.feature` only in the same
  parcel as its step handlers.

  A phone opening a download link cannot set an `Authorization` header, so
  sideload APKs are served from a branch placed ahead of the 401 gate on a
  bridge that terminates a public tunnel. The motivation is sound; the branch
  is an unauthenticated read primitive on the host and has never been
  reviewed. These scenarios pin what it may and may not reach. Note that
  containment against the whole input space is stated as an invariant on the
  ticket and is a property test, not an example list — scenario 03 samples it,
  it does not discharge it.

  Background:
    Given a bridge serving sideload APKs from the published public directory

  # BL-851 sideload-apk-preauth-01
  Scenario: a published APK is served with no credentials
    Given a published APK in the public directory
    When it is requested by name without credentials
    Then it is served
    And it is served as an Android package download

  # BL-851 sideload-apk-preauth-02
  Scenario: a name that matches the pattern but has no file behind it is not found
    Given no file of that name in the public directory
    When it is requested by name without credentials
    Then the response is not found

  # BL-851 sideload-apk-preauth-03
  Scenario Outline: nothing outside the public directory is ever served
    Given a request naming <target> outside the public directory
    When it is requested without credentials
    Then no file content is served

    Examples:
      | target                                   |
      | a plainly encoded parent-directory climb |
      | a doubly encoded parent-directory climb  |
      | a backslash-separated climb              |
      | a symlink inside the directory pointing outside it |

  # BL-851 sideload-apk-preauth-04
  Scenario: a directory is not a download
    Given a directory in the public directory whose name matches the pattern
    When it is requested without credentials
    Then no file content is served

  # BL-851 sideload-apk-preauth-05
  Scenario: every other route still demands the bearer
    Given a request to any route other than a published APK
    When it is made without credentials
    Then it is rejected as unauthorized
