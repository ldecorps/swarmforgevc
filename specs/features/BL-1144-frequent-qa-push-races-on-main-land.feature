Feature: frequent QA push races on main land are reduced
  Human reports push races all the time during QA approve→land. Rematch
  recovery (BL-1130 / BL-1131 / BL-1138 / BL-1141) works; frequency is the
  defect — concurrent publishers to origin/main while long QA gates hold a
  tip on a stale base. Specifier locks late tip rematch at publish (bounded
  retry) plus serialize land/close publishers so a second writer waits or
  rematches once at the lock edge. Tip purity stays mandatory; no force-push;
  residual race stays rematch lander — never human absorb. Source:
  backlog/INTAKE-frequent-qa-push-races-on-main-land.md.

  Background:
    Given rematch-then-FF absorb recovery already lands residual races
    And tip purity vs origin/main remains mandatory for landed tips

  # BL-1144 publish-time-rematch-01
  Scenario: publish-time tip rematch is authoritative before land push
    Given a QA tip that was tip-pure at gate start
    And origin/main advanced during the gate window
    When the land path reaches publish
    Then it fetches and rematches for tip purity immediately before push
    And a residual race retries within a bounded limit then lands FF or waits on the land lock

  # BL-1144 serialize-publishers-02
  Scenario: concurrent land or close publishers serialize at a lock edge
    Given two concurrent land or close publishers targeting origin/main
    When both attempt to publish
    Then the second waits or rematches once at the land/close lock edge
    And unbounded tip-purity bounce loops do not run mid-gate after a peer push

  # BL-1144 tip-purity-and-rematch-hold-03
  Scenario: tip purity and rematch-absorb posture hold
    When a residual push race still occurs after the controls
    Then the landed tip is tip-pure vs origin/main
    And designed recovery is rematch lander or rematch bookkeeping
    And no human absorb merge is required
