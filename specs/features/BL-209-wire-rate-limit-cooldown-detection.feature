Feature: Rate-limited agents wait for reset instead of blind-retrying

# BL-209 detect-and-record-01
Scenario: a usage-limit message in a pane records a cooldown until its reset time
  Given a role's agent pane emits a provider usage-limit message stating a reset time
  When the extension processes that pane output
  Then a cooldown is recorded for that role until the parsed reset time

# BL-209 suppress-wake-02
Scenario: the live wake sweep does not chase a cooling-down role
  Given a role has a recorded rate-limit cooldown that has not yet expired
  When the live daemon chase/wake sweep runs
  Then it does not send that role a wake or retry

# BL-209 resume-at-reset-03
Scenario: waking resumes once the reset time passes
  Given a role whose rate-limit cooldown reset time has passed
  When the live daemon chase/wake sweep runs
  Then the role is woken once to resume work
  And its rate-limit cooldown is cleared so it does not re-trigger

# BL-209 ordinary-output-noop-04
Scenario: ordinary pane output does not trigger a cooldown
  Given a role's pane output contains no usage-limit message
  When the extension processes that pane output
  Then no rate-limit cooldown is recorded

# Non-behavioral gates:
#  - Reuse BL-082's cooldownScheduler.ts (parseResetTime/recordCooldown/
#    isCoolingDown/shouldWakeOnExpiry); do not rebuild it.
#  - Enforcement wires into the LIVE daemon sweep (chase_sweep_lib.bb), not the
#    retired inboxChaser.runSweep; cooldown state passes extension->daemon as a
#    file, mirroring respawn-cooldown.json.
#  - Per-role cooldown; account-wide propagation is out of scope.
#  - Injected/fake clock in tests; no real timers.
