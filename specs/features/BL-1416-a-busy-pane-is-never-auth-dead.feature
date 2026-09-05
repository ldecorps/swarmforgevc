Feature: BL-1416 The auth-class observer never counts a busy pane, and skipped respawns never reach the persist alert

  BL-536's observer captures each role's visible pane every tick and
  classifies it :auth when the text matches invalid api key, authentication
  failed, authenticationerror or unauthorized. On 2026-09-05 at 05:39Z the
  hardener was thirty minutes into a scoped mutation run of
  providerChatSeat.test.js, whose assertions print "answered 401: invalid
  api key" into the pane. The observer classified the pane :auth three ticks
  running, each respawn was skipped because the pane showed the runtime's
  busy footer, the skipped attempts still counted toward the cap, and the
  persist alert went to Telegram and email: "Auth-class failure persists on
  role 'hardender' after 3 respawn attempts (BL-536). Provider credentials
  likely need manual attention." The credentials were fine; the process had
  been working uninterrupted for 26 minutes.

  This feature is that a pane whose runtime reports itself busy is never
  classified auth-dead, that an attempt skipped for busy is not an attempt,
  and that a persist alert names the pane text it matched so a human can
  tell a real credential failure from a test that mentions one.

  Background:
    Given a role whose pane text is fed to the auth-class observer tick by tick

  # BL-1416 busy-pane-is-healthy-01
  Scenario Outline: auth-shaped text on a pane showing the busy footer is classified healthy
    Given the pane shows the runtime's busy footer and its text contains "<text>"
    When the observer tick runs
    Then the classification is healthy
    And no respawn is attempted and no attempt is counted

    Examples:
      | text                                   |
      | answered 401: invalid api key          |
      | authentication failed                  |
      | unauthorized                           |

  # BL-1416 idle-auth-error-still-respawns-02
  Scenario: the runtime's own auth error on an idle pane still respawns
    Given the pane is idle at the prompt and shows the runtime's own line "Invalid API key"
    When the observer tick runs
    Then the classification is auth
    And a respawn is attempted and counted

  # BL-1416 skipped-attempts-never-reach-the-alert-03
  Scenario: three ticks that each skip the respawn for a busy pane never produce the persist alert
    Given the pane text would classify auth if the pane were idle
    When 3 observer ticks run while the pane shows the busy footer
    Then no respawn is attempted
    And no persist alert is sent

  # BL-1416 the-alert-names-what-it-matched-04
  Scenario: a persist alert names the matched pane line
    Given 3 idle-pane auth observations have each respawned the role
    When the next idle-pane auth observation runs
    Then the persist alert is sent once
    And it names the matched line and the number of real respawns

  # BL-1416 the-2026-09-05-hardender-pane-is-healthy-05
  Scenario: the hardener's 2026-09-05 pane capture classifies healthy
    Given the hardener's pane text as captured on 2026-09-05 during its BL-1383 mutation run
    When the observer tick runs
    Then the classification is healthy
