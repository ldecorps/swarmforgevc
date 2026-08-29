Feature: BL-1264 a pending-approval entry carries an approval context only when it has one

  The pending-approval set is built by copying three fields off each ticket.
  Two of them always exist. The third, the approval context, is declared
  optional on the entry's own interface and is genuinely absent from most
  tickets - but it is copied unconditionally, so an entry for a ticket that
  has no context still carries the key, holding the value undefined.

  Nothing downstream notices, because serialising the set to the artefact the
  dashboard reads drops undefined-valued keys on the way out. The whole
  discrepancy lives on the in-memory path, which is where the comparison that
  catches it happens to look.

  An optional field that is always present is not optional, and the two
  shapes are distinguishable to every strict comparison in the suite. The
  entry should carry the key when there is a context to carry and omit it
  otherwise - and an absent context must stay absent rather than becoming an
  empty string or a placeholder, because every reader of the field already
  treats a missing context as nothing to show.

  Background:
    Given a live ticket whose approval is pending

  # BL-1264 an-absent-approval-context-is-an-absent-key-01
  Scenario Outline: the key is present exactly when the ticket has a context
    Given the ticket <context state> an approval context
    When the pending-approval set is computed
    Then the entry <key state> an own approval context key

    Examples:
      | context state | key state    |
      | carries       | carries      |
      | does not have | does not have |

  # BL-1264 an-absent-approval-context-is-an-absent-key-02
  Scenario: the serialised dashboard artefact is unchanged by the fix
    Given a fixture backlog that produces a pending-approval set
    When the dashboard artefact is generated before and after the change
    Then the two artefacts are identical

  # BL-1264 an-absent-approval-context-is-an-absent-key-03
  Scenario: a missing context never becomes a placeholder value
    Given a ticket that does not have an approval context
    When the pending-approval set is computed
    Then the entry carries no empty string and no null in place of the context
