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
