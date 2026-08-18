Feature: the rotate gate protects the mailbox of the role the pane is really running

  # BL-927 (swarm-reliability). handoff-lib/departing-role-blocking-handoff
  # picks whose in_process box the resident-invoked rotate gate protects, and
  # reads .swarmforge/mono-router-active-role and nothing else. Its docstring
  # says it fails OPEN rather than "guessing an identity and gating on the wrong
  # role's mailbox" — but the only cases it can detect are a missing/blank
  # marker or an unknown roles.tsv row. A marker that is present, well-formed
  # and simply WRONG is indistinguishable from a correct one, so it fails CLOSED
  # into exactly the outcome it set out to avoid.
  #
  # BL-921 established that marker-vs-pane divergence is real and recurring, and
  # shipped resident-live-role plus live-role-agrees? with the
  # unreadable-is-divergence rule. This call site never got them.
  #
  # The boundary this pins: an identity that cannot be read is DIVERGENCE, never
  # agreement — and divergence widens the existing fail-open, it never narrows
  # it into a refusal derived from the marker alone.
  #
  # Step handlers: specs/pipeline/steps/bl927RotateGateLiveIdentitySteps.js,
  # driving the gate against fixture mono-router layouts with an injectable
  # identity probe (no live tmux). The <decision> and <marker state> columns are
  # validated against explicit KNOWN_VALUES, never passed through.

  Background:
    Given a mono-router pack whose single resident pane serves every role in turn

  # BL-927 rotate-gate-live-identity-01
  Scenario Outline: the gate reads the box of the role the pane is really running
    Given the active-role marker names "<marker>"
    And the resident pane's live identity is "<live>"
    And role "<box owner>" holds a real parcel in its in_process box
    When the resident invokes rotation to "documenter"
    Then the rotate gate decision is "<decision>"

    Examples:
      | marker  | live  | box owner | decision |
      | cleaner | coder | cleaner   | proceed  |
      | cleaner | coder | coder     | refuse   |
      | coder   | coder | coder     | refuse   |

  # BL-927 rotate-gate-live-identity-02
  Scenario: an unreadable live identity counts as divergence and never as agreement
    Given the active-role marker names "cleaner"
    And the resident pane's live identity cannot be read
    And role "cleaner" holds a real parcel in its in_process box
    When the resident invokes rotation to "documenter"
    Then the rotate gate decision is "proceed"

  # BL-927 rotate-gate-live-identity-03
  Scenario Outline: a departing role that cannot be determined at all still fails open
    Given the active-role marker is <marker state>
    And the resident pane's live identity is "coder"
    When the resident invokes rotation to "documenter"
    Then the rotate gate decision is "proceed"

    Examples:
      | marker state |
      | missing      |
      | blank        |

  # BL-927 rotate-gate-live-identity-04
  Scenario: the daemon's own rotation stays ungated so chase-driven drain cannot deadlock
    Given the active-role marker names "cleaner"
    And role "cleaner" holds a real parcel in its in_process box
    When the handoff daemon's own chase rotates the resident to "cleaner"
    Then the rotation proceeds without consulting the rotate gate
