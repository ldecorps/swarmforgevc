Feature: BL-1128 raise active_backlog_max_depth on sustained host headroom
  # When CPU and memory have sustained headroom and Article 3.5 throttle is
  # not degraded/severe, a deterministic owner may raise the standing
  # configured active_backlog_max_depth (durable, reversible, ceiling-
  # bounded). The same owned step may unhold eligible hold/ tickets to
  # paused/ and prefer depth/cap/throttle tickets for new slots.

  # Design lock (specifier 2026-08-25):
  # - Owner: deterministic CLI the coordinator must run (mirror Article 3.5
  #   auto-lower posture); coordinator does not hand-edit depth ad hoc.
  # - Write target: single authority — the configured source
  #   effective_backlog_depth_cli already treats as standing max (pack conf
  #   when the live pack pins active_backlog_max_depth; otherwise
  #   swarmforge.conf). Never fork two writers.
  # - Headroom: sustained window mirroring host_load_sustained_minutes;
  #   CPU idle + free/available Mem thresholds from existing host_load_* /
  #   BL-822 samples — no one-sample spike; no GPU/Ollama VRAM as primary.
  # - Raise: step +1 (configurable), hard ceiling
  #   active_backlog_max_depth_ceiling, cooldown between raises; durable
  #   conf write + audit record; reversible documented undo.
  # - Safety: never raise (and never unhold) while throttle diagnosis is
  #   degraded/severe; never raise above ceiling; human override wins.
  # - Unhold: eligible hold/ → paused/ only (not active/); UNHOLD note;
  #   refuse silent mass unhold of human-parked holds without policy tag;
  #   never bypass depends_on / human_approval.
  # - Depth preference: when promoting into newly opened slots, prefer
  #   paused tickets tagged or titled as depth/cap/throttle correctness
  #   (e.g. BL-683 class) over unrelated low-priority work.
  # - Slice 1 ships durable raise + unhold + preference; ceremony-only
  #   recommend is not a substitute for the human's config-level ask.

  # BL-1128 headroom-raises-configured-cap-01
  Scenario: sustained CPU and memory headroom raises the standing configured cap
    Given host CPU and free memory stay within headroom thresholds for the sustained window
    And Article 3.5 throttle diagnosis is not degraded or severe
    And configured active_backlog_max_depth is below the hard ceiling
    When the headroom raise CLI runs
    Then active_backlog_max_depth on the single configured write target increases by the documented step
    And effective_backlog_depth_cli reflects the higher configured ceiling
    And an audit record of the raise is written

  # BL-1128 no-raise-under-pressure-or-throttle-02
  Scenario: pressure or rework throttle blocks raise and leaves hold alone
    Given high CPU or memory pressure or a degraded or severe throttle recommendation
    When the headroom raise CLI runs
    Then configured active_backlog_max_depth is unchanged
    And backlog/hold is left untouched

  # BL-1128 unhold-eligible-on-raise-03
  Scenario: a successful raise reinstates eligible holds to paused with UNHOLD notes
    Given eligible tickets exist under backlog/hold
    And a headroom raise succeeds
    When the same owned unhold step runs
    Then those eligible tickets move hold to paused with an UNHOLD note each
    And they are not auto-promoted into active past the new cap
    And human-parked holds without eligibility stay in hold

  # BL-1128 prefer-depth-tickets-for-new-slots-04
  Scenario: newly opened slots prefer depth cap throttle tickets
    Given the configured cap just increased and paused depth or cap or throttle tickets exist alongside unrelated low-priority work
    When ordinary promotion fills a newly opened slot
    Then a depth or cap or throttle correctness candidate is preferred over the unrelated low-priority ticket

  # BL-1128 ceiling-cooldown-reversible-05
  Scenario: raises respect ceiling cooldown and remain reversible
    Given configured depth is at the hard ceiling or a raise cooldown is active
    When the headroom raise CLI runs
    Then no further raise is applied
    And a prior raise can be undone via the documented reversible path restoring the previous configured value
