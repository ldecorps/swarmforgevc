Feature: BL-1411 A forward built on an amended acceptance contract is refused at the send

  A ticket's acceptance contract can be amended on main while a role holds
  the parcel (BL-317/BL-325). The rule that makes the amendment reach the
  holder is a note the specifier sends to whoever holds the parcel, and on
  2026-09-05 that rule failed twice in one shift, once in each direction it
  can fail. BL-1370's amendment (3daeaf5b1c, 00:01Z) was landed with no note
  because the amending pass believed nothing was built yet; the coder
  forwarded a commit built on the pre-amendment contract 29 minutes later,
  and the cleaner bounced it as spec-gap, charged to the coder. BL-1353's
  note reached the coder after the parcel had already left, and the coder
  and the cleaner then fixed the same handler on two branches. Nothing
  mechanical asked, at the moment of sending, whether the contract the
  parcel was built against was still the contract on main.

  This feature is that swarm_handoff.sh asks that question itself on every
  git_handoff: when main has changed the ticket's acceptance feature file
  since the sender's merge-base with main, the send is refused and not
  queued, naming the amending commit, the path and the remedy (merge main,
  replay, send again). The comparison is main against the sender's base,
  never the parcel tip, so nothing a parcel legitimately does to its own
  copy can trip it. Only the acceptance feature file is compared: the
  ticket YAML is bookkeeping every role appends to and merges (BL-1391),
  and an amendment carried in notes alone (the hardener-or-later route,
  BL-1385) is outside this slice.

  Background:
    Given a fixture repository whose main branch carries ticket BL-9001 and its acceptance feature file
    And a sender worktree branched from main holding a commit for BL-9001

  # BL-1411 unchanged-contract-forwards-01
  Scenario: a forward whose contract main has not touched since the base is queued
    When the sender sends a git_handoff for BL-9001 naming that commit
    Then the handoff is queued
    And the output carries no contract-amended refusal

  # BL-1411 amended-on-main-since-base-is-refused-02
  Scenario: a forward whose contract main amended after the base is refused naming the amendment
    Given main amended BL-9001's acceptance feature file after the sender branched
    When the sender sends a git_handoff for BL-9001 naming that commit
    Then the handoff is not queued
    And the refusal names the amending commit, the feature path and the remedy to merge main and send again

  # BL-1411 main-against-the-base-never-the-parcel-03
  Scenario Outline: a difference that is not an amendment on main after the base does not refuse
    Given <state>
    When the sender sends a git_handoff for BL-9001 naming that commit
    Then the handoff is queued
    And the output carries no contract-amended refusal

    Examples:
      | state                                                                              |
      | the sender's own commit rewrote the feature file's header and main is untouched    |
      | main amended the feature file and the sender merged main before committing         |

  # BL-1411 an-unreadable-contract-is-stated-not-refused-04
  Scenario: a contract the gate cannot read on main is reported and never refuses
    Given BL-9001's acceptance path does not exist on main
    When the sender sends a git_handoff for BL-9001 naming that commit
    Then the handoff is queued
    And the output states that the contract freshness check was not evaluated and why
