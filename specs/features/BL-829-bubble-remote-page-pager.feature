Feature: Bubble's pager renders the bundle's pages without ever stranding the Talk surface

  BL-825 decides which UI bundle Bubble renders. This slice renders from it: the
  manifest names its pages, the shell turns that list into pager entries beside
  the native Talk page, and every failure mode resolves to a stated reason rather
  than a blank WebView.

  The manifest half is TypeScript and runs in the Node acceptance runner. The
  bundle-to-pager-list decision is pure Kotlin with no android.* type in its own
  signature, so per the constitution's Testability Boundary — Bubble it is
  verified by the JVM unit suite with no emulator and no connected device. The
  WebView render itself and the pager gesture are device surface, verified by the
  manual procedure recorded in BL-829.

  # BL-829 bundle-pages-served-01
  Scenario: the manifest names the pages the shell may open
    Given a running swarm and the bridge started via its opt-in command
    When the served UI bundle manifest is read
    Then each page it names carries an id, a title, an entry path and an order

  # BL-829 bundle-pages-rejected-whole-02
  Scenario: a malformed page list rejects the whole manifest
    Given a running swarm and the bridge started via its opt-in command
    And the served manifest carries a malformed page list
    When the manifest is validated
    Then it is rejected whole
    And no page from it is offered to the shell

  # BL-829 pager-list-resolution-03
  Scenario Outline: the pager's page list is covered by the JVM unit suite
    Given the Bubble Android module
    When the JVM unit suite is run
    Then it exercises <decision>

    Examples:
      | decision                                                                 |
      | ordering the pager entries as the manifest orders its pages              |
      | dropping a page entry the installed shell cannot honour                  |
      | offering Talk alone when the resolver returned the bare outcome          |
      | marking the pager entries stale when the resolver returned the stale outcome |

  # BL-829 pager-opens-on-talk-04
  Scenario: the pager still opens on the native Talk page
    Given the Bubble Android module
    When the JVM unit suite is run
    Then it exercises Talk remaining the pager's opening page whatever the bundle offers

  # BL-829 page-allowlist-05
  Scenario: the shell opens only pages the manifest authorized
    Given the Bubble Android module
    When the JVM unit suite is run
    Then it exercises refusing to resolve a page id the manifest did not name
