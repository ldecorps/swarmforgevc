# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-18T11:44:49.710959Z","feature_name":"Chase verifies the resident pane's live identity before waking it","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-921-chase-verifies-live-pane-identity.feature","background_hash":"c2773fb58f3d51b5c7e856e6d2d25a48be317c56e6bdab46f0588f790437a5a8","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: Chase verifies the resident pane's live identity before waking it

  Under mono-router one pane serves every role in turn. Chase decides how to
  poke a dormant role by reading .swarmforge/mono-router-active-role, a marker
  file written at rotation. When that file disagrees with the identity the pane
  is actually running, chase concludes the resident already IS the target role
  and injects wake text instead of respawning it — so the wake lands on the
  wrong persona, which reads its own empty mailbox and idles, forever.

  Background:
    Given a mono-router pack whose resident pane session exists
    And the role "cleaner" has no standing session of its own

  # BL-921 chase-identity-verified-wake-01
  Scenario Outline: A resident wake requires the pane's own identity to agree
    Given the active-role marker reads "<marker>"
    And the resident pane's live identity is "<live_identity>"
    When chase decides how to poke the role "cleaner"
    Then the decision is "<action>"

    Examples:
      | marker  | live_identity | action        |
      | cleaner | coder         | rotate        |
      | cleaner | cleaner       | wake-resident |
      | coder   | coder         | rotate        |
      | cleaner | unreadable    | rotate        |

  # BL-921 chase-identity-verified-wake-02
  Scenario: A role with its own standing pane is decided without consulting either identity
    Given the role "architect" has a standing session of its own
    And the active-role marker reads "architect"
    And the resident pane's live identity is "coder"
    When chase decides how to poke the role "architect"
    Then the decision is "wake-own-session"

  # BL-921 chase-identity-verified-wake-03
  Scenario: The rotation gate does not refuse a rotate as already-active on a diverged pane
    Given the active-role marker reads "cleaner"
    And the resident pane's live identity is "coder"
    When the rotation gate is asked whether to rotate the resident to "cleaner"
    Then the gate does not answer "already-active"

  # BL-921 chase-identity-verified-wake-04
  Scenario: A diverged marker produces no wake text however many sweeps run
    Given the active-role marker reads "cleaner"
    And the resident pane's live identity is "coder"
    And the mailbox of "cleaner" holds an unclaimed handoff
    When the chase sweep runs 5 times
    Then no wake text is injected into the resident pane
