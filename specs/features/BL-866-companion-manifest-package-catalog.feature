Feature: the bridge advertises versioned JSON packages a phone can cache and refresh cheaply

  # BL-866 (epic BL-865, foundation slice): the human settled that the phone's online sync
  # source is the BRIDGE and the wire format stays REST + versioned JSON packages, not
  # protobuf. Offline is a package + on-device store + outbox problem, and this slice is the
  # package half's contract: a companion-manifest listing each available package with its
  # generation, and package bodies served against that generation. The manifest is what makes
  # a refresh SILENT — the phone asks what changed rather than re-downloading a corpus that
  # did not, which matters once the BL-659 corpus (~2-3 MB compressed) lives on the device.
  # This slice is bridge-side only and fully testable in the Node unit suite; the phone-side
  # fetch and cache are a later slice of BL-865. The bridge has no package catalog today:
  # `/lets-talk/manifest.json` is a PWA web-app install descriptor, unrelated.

  Background:
    Given a bridge serving an authorized client

  # BL-866 manifest-lists-packages-and-generations-01
  Scenario: the manifest names each available package with its generation
    Given the backlog and docs packages are available
    When the companion manifest is requested
    Then each available package is listed
    And each listed package carries a generation
    And each listed package carries a format version

  # BL-866 package-body-matches-its-advertised-generation-02
  Scenario: a package is served at the generation the manifest advertised
    Given the manifest advertises the backlog package at a generation
    When that package is requested
    Then the served body carries that same generation

  # BL-866 unchanged-generation-is-not-resent-03
  Scenario: asking for a generation the client already holds does not resend the body
    Given a client holds the backlog package at its current generation
    When that client requests the package naming the generation it holds
    Then it is told the package is unchanged
    And no package body is sent

  # BL-866 changed-generation-is-sent-04
  Scenario: asking with a stale generation sends the new body
    Given a client holds the backlog package at an older generation
    When that client requests the package naming the generation it holds
    Then the current body is sent
    And the body carries the current generation

  # BL-866 manifest-never-advertises-what-it-cannot-serve-05
  Scenario: a package whose source cannot be read is not advertised
    Given the docs package source cannot be read
    When the companion manifest is requested
    Then the docs package is not listed
    And the backlog package is still listed

  # BL-866 unreadable-package-is-refused-not-served-empty-06
  Scenario: a package that became unreadable is refused rather than served empty
    Given the manifest advertised the docs package
    And the docs package source then became unreadable
    When that package is requested
    Then the request is refused with a reason
    And nothing is served in place of the unreadable package

  # BL-866 unknown-package-is-refused-07
  Scenario: an unknown package name is refused clearly
    When a package that does not exist is requested
    Then the request is refused with a reason naming the unknown package

  # BL-866 catalog-requires-authorization-08
  Scenario Outline: the catalog is reachable only by an authorized client
    Given a client that is <authorization>
    When <target> is requested
    Then the request is <outcome>

    Examples:
      | authorization  | target                | outcome  |
      | authorized     | the companion manifest| served   |
      | unauthorized   | the companion manifest| refused  |
      | unauthorized   | the backlog package   | refused  |
