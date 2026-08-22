# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-12T07:06:57.085228Z","feature_name":"BL-880 stale acceptance pointer refused at first hop","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-880-stale-acceptance-pointer-refused-at-first-hop.feature","background_hash":"15fe6908c6013681620f6aff0f83cd4b87a8f000bc3ee3e2262449414b1fc8ea","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-880 stale acceptance pointer refused at first hop
  A git_handoff whose ticket declares a single-line acceptance: path that
  does not exist at the cited commit is refused at the FIRST pipeline hop,
  not five stages later at the documenter-to-QA edge. Existence is the ONLY
  thing checked early; BL-761's full contract evaluation stays at the QA
  edge unchanged.

  Background:
    Given a repository with a ticket "BL-999" whose YAML declares a single-line acceptance: path
    And a git_handoff draft for ticket "BL-999" citing a commit

  # BL-880 stale-acceptance-refused-first-hop-01
  Scenario: a pointer naming a path absent at the cited commit refuses a coder-to-cleaner send
    Given the declared acceptance path does not exist at the cited commit
    And the draft's recipient is "cleaner"
    When the sender runs swarm_handoff on the draft
    Then the send is refused
    And the refusal names ticket "BL-999", the declared acceptance path, and the cited commit

  # BL-880 stale-acceptance-refused-first-hop-02
  Scenario: a parked feature draft that exists at the cited commit passes a pre-QA hop
    Given the declared acceptance path exists at the cited commit
    And the declared acceptance path ends in ".feature.draft"
    And the parked draft's steps have no registry handlers
    And the draft's recipient is "cleaner"
    When the sender runs swarm_handoff on the draft
    Then the send proceeds

  # BL-880 stale-acceptance-refused-first-hop-03
  Scenario: a blank acceptance declaration is not refused before the QA edge
    Given the ticket's acceptance declaration is blank
    And the draft's recipient is "cleaner"
    When the sender runs swarm_handoff on the draft
    Then the send proceeds

  # BL-880 stale-acceptance-refused-first-hop-04
  Scenario: an unreadable tree at the cited commit warns and fails open before the QA edge
    Given the repository tree at the cited commit cannot be read
    And the draft's recipient is "cleaner"
    When the sender runs swarm_handoff on the draft
    Then the send proceeds
    And a warning names the infrastructure failure

  # BL-880 stale-acceptance-refused-first-hop-05
  Scenario: the documenter-to-QA edge still evaluates the full acceptance contract
    Given the declared acceptance path exists at the cited commit
    And its scenarios contain a step no registry handler resolves
    And the draft's recipient is "QA"
    When the sender runs swarm_handoff on the draft
    Then the send is refused with an acceptance-contract finding
