Feature: Every forwarding surface says the image was not read

  # BL-955, architect send-back on BL-620 (2026-08-19): BL-620 landed the
  # "no vision, said out loud" principle as a general statement in its
  # description ("routed content carries a short annotation that an attached
  # image was not read"), but its acceptance criteria scoped the annotation
  # to ONE path - scenario 04 covers only backlog-topic routing. BL-620's
  # shared messageTextOf seam simultaneously taught EVERY text-reading
  # surface to read captions, so the remaining forwarding surfaces now carry
  # caption-derived words onward with no annotation at all. A human or an
  # agent reading them has no way to know an unread image was attached -
  # exactly the belief the incident directive ("I hope you have vision to
  # see the picture") demanded the front desk never create.
  #
  # Verified live at the architect-forwarded commit, not taken on report:
  # annotateRoutedMediaText has exactly three call sites, all inside
  # processMessageUpdate's backlog-topic branch. The six surfaces below each
  # forward messageTextOf output onward - to an agent's pane, to a bridge
  # thread, to the onboarder, to a negotiation session, or into a durable
  # record - with the raw text. Epic swarm-reliability.
  #
  # Control-topic delivery is deliberately NOT in this list: its text is
  # PARSED as a command, never displayed, so appending a note to it would
  # corrupt the parse. Scenario 03 pins that exclusion as a guard, so a
  # future "annotate everything" sweep cannot quietly break command parsing.

  Background:
    Given a front-desk bot bound to its own group with the principal configured

  # BL-955 every-forwarding-surface-annotates-01
  Scenario Outline: a forwarding surface passes on caption text with the image-not-read note
    Given the "<surface>" surface is wired
    When the principal sends a photo whose caption carries the message words
    Then the text that surface forwards notes the attached image was not read by the front desk
    And the text that surface forwards still contains the caption's own words

    Examples:
      | surface                 |
      | steering                |
      | agent-questions         |
      | onboarding              |
      | negotiation-relay       |
      | approvals-reject-reason |
      | recert-amend-text       |

  # BL-955 plain-text-forwarded-unchanged-02
  # One representative surface is enough for this guard: the annotation is a
  # single shared seam, so "does it stay silent when nothing is attached" is
  # a property of that seam, not of each call site - while scenario 01 above
  # is what proves each call site reaches the seam at all.
  Scenario: a message with no attachment is forwarded byte-identical
    Given the "steering" surface is wired
    When the principal sends the same words as a plain text message
    Then the text that surface forwards equals the message words exactly
    And the text that surface forwards carries no image-not-read note

  # BL-955 control-command-parse-unannotated-03
  Scenario: a control command sent as a photo caption still parses as that command
    Given the "control-delivery" surface is wired
    When the principal sends a control command as a photo caption
    Then the command executes exactly as the identical plain-text command would
    And no image-not-read note is appended to the text the command parser reads
