# mutation-stamp: sha256=f61579e37a6897073778f10eaa9ddd92f6f03109089eb8d21bbca13b9d95f64e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-18T00:10:32.828121Z","feature_name":"Stamp Bubble cold-start expand fixes (overlay trampoline, splash, panel dismiss)","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-916-bubble-cold-start-expand-swarm-stamp.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":4,"name":"the Android 12+ splash cannot leave a launcher icon stuck","scenario_hash":"97d3f277f577b1765f274b27a7d475176d8d75fbb3adf4f17cf87d3c90d12ec0","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-18T00:10:32.828121Z"}]}
# acceptance-mutation-manifest-end

Feature: Stamp Bubble cold-start expand fixes (overlay trampoline, splash, panel dismiss)

  # BL-916 stamp-off for landed hotfix 8da0f52e59 (v0.3.17-open-talk). After a
  # force-stop/cold start the floating disc drew but a short tap did nothing:
  # Samsung's background-activity launch block silently dropped
  # startActivity(TalkPanelActivity) from the overlay service with no activity
  # in the foreground. Iterating on the phone surfaced two follow-on freezes
  # that the same hotfix had to close — a stuck Android 12+ splash, and the
  # overlay's own finger-up dismissing the panel as an outside tap.
  # Source: human via Cursor 2026-08-17, confirmed live on the phone.
  #
  # HONEST SCOPE OF THIS FILE — read before adding to it. Every behaviour this
  # hotfix fixes is DEVICE-SURFACE (a running Service, the overlay window, the
  # activity lifecycle). Per BL-769 that is reachable by neither the JVM unit
  # suite nor the Node acceptance runner, which cannot execute Kotlin at all.
  # So the scenarios below are deliberately CONFIGURATION AND STRUCTURE guards,
  # not behavioural proofs: each pins one thing whose silent reversal would
  # restore one of the three freezes. They are a regression net, not evidence
  # the bubble opens. That evidence is the recorded manual procedure in the
  # ticket's qa_e2e_procedure, and it is the ticket's primary acceptance.

  # BL-916 overlay-never-starts-the-panel-directly-01
  Scenario: the overlay reaches Talk only by way of the launcher activity
    Given the overlay service's open-Talk path
    Then it targets MainActivity
    And it never names TalkPanelActivity, whose direct start is what Samsung dropped

  # BL-916 trampoline-target-stays-launchable-02
  Scenario: the trampoline target is still declared so a background start can land on it
    Given the Android manifest declaration for MainActivity
    Then it is exported
    And its launch mode is singleTop, so a re-entrant open reuses the task

  # BL-916 launcher-activity-does-not-finish-its-own-task-03
  Scenario: opening the app does not finish the pairing task and strand the splash
    Given MainActivity's creation path
    Then it does not finish or remove its own task there
    And the pairing screen is left on screen as the accepted trade-off

  # BL-916 panel-survives-the-overlay-finger-up-04
  Scenario: the panel does not treat the overlay's own finger-up as an outside tap
    Given the dialog theme used by the Talk panel
    Then closing on a touch outside the window is disabled

  # BL-916 splash-cannot-stay-on-screen-05
  Scenario Outline: the Android 12+ splash cannot leave a launcher icon stuck
    Given the API 31+ theme for the companion
    Then <splash property> is set so no launcher icon can remain on screen

    Examples:
      | splash property                    |
      | a transparent splash animated icon |
      | a zero splash animation duration   |
