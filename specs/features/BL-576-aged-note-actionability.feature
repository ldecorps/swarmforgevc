Feature: Aged notes in a dormant mailbox make a mono-router role worth rotating to

  Under `config rotation router` one resident process plays every pipeline role in
  turn and the other roles are dormant mailboxes with no pane. The chase sweep
  decides whether a dormant role's mail is worth rotating the resident for, and
  that decision deliberately counts only in-process work and git_handoffs — notes
  never qualify, so a five-way QA merge-up broadcast cannot thrash the resident
  through five rotations in a row.

  The same protection swallows every note that IS work. Design kickoffs, steering
  and merge-up instructions all travel as `type: note`, so a note to a dormant role
  is refused on every sweep while its delivery wake remaps to the resident pane,
  which runs ready_for_next as its CURRENT role, finds its own mailbox empty and
  reports NO_TASK. Observed 2026-07-23: four specifier-bound notes unread for ten
  hours, an all-morning skip-broadcast log, and multi-minute resident turns burnt
  on wakes meant for another role's mail.

  AGE separates the two cases. A fresh note is broadcast noise the resident need
  not chase; a note nobody has looked at for tens of minutes is work nobody will
  ever see. Everything else about rotation is unchanged: the newest-mail ordering
  rule, the busy gate, the rotate cooldown, the one-inject-per-sweep resident
  budget, and the drain side.

  Background:
    Given a mono-router pack whose home resident is coder

  # BL-576 aged-note-actionability-01
  Scenario Outline: a note rotates the resident only once it has aged past the threshold
    Given the specifier is dormant and holds one note enqueued <note_age> the aged-note threshold
    And the resident is idle and outside the rotate cooldown
    When the chase sweep reaches the specifier
    Then the resident rotation to specifier is <outcome>
    And the chase logs "<log_tag>" for specifier

    Examples:
      | note_age      | outcome   | log_tag                     |
      | well past     | performed | chase-rotate                |
      | well short of | refused   | chase-rotate-skip-broadcast |

  # BL-576 aged-note-actionability-02
  Scenario Outline: the age clock is the parcel header — enqueued_at, then created_at, never the file
    Given the default 20-minute aged-note threshold is in effect
    And the specifier is dormant and holds one note with enqueued_at <enqueued_at>, created_at <created_at> and file mtime <mtime>
    When the chase sweep reaches the specifier
    Then the resident rotation to specifier is <outcome>

    Examples:
      | enqueued_at    | created_at     | mtime        | outcome   |
      | 45 minutes ago | 45 minutes ago | 1 minute ago | performed |
      | 2 minutes ago  | 10 hours ago   | 10 hours ago | refused   |
      | absent         | 45 minutes ago | 1 minute ago | performed |
      | unparseable    | 45 minutes ago | 1 minute ago | performed |
      | absent         | absent         | 10 hours ago | refused   |

  # BL-576 aged-note-actionability-03
  Scenario Outline: the newest actionable mail still wins, and an aged note now competes
    Given the specifier is dormant and holds an aged note created at <note_created>
    And <rival> is dormant and holds a <rival_type> created at <rival_created>
    And the resident is idle and outside the rotate cooldown
    When the chase sweep runs
    Then the resident is rotated to <preferred>

    Examples:
      | note_created | rival      | rival_type  | rival_created | preferred |
      | 08:00Z       | cleaner    | git_handoff | 09:00Z        | cleaner   |
      | 09:00Z       | cleaner    | git_handoff | 08:00Z        | specifier |
      | 09:00Z       | documenter | aged note   | 08:00Z        | specifier |
      | 08:00Z       | cleaner    | fresh note  | 09:00Z        | specifier |

  # BL-576 aged-note-actionability-04
  Scenario Outline: the threshold is read from the effective config and degrades to its default
    Given the effective config contains the line "<conf_line>"
    When the aged-note threshold is resolved
    Then the threshold is <threshold>

    Examples:
      | conf_line                              | threshold  |
      | config note_actionable_after_ms 600000  | 10 minutes |
      |                                        | 20 minutes |
      | config note_actionable_after_ms abc     | 20 minutes |
      | config note_actionable_after_ms 0       | 20 minutes |
      | config note_actionable_after_ms -1      | 20 minutes |

  # BL-576 aged-note-actionability-05
  Scenario: a five-role aged broadcast drains one role at a time, never mid-turn
    Given the specifier, cleaner, architect, hardender and documenter each hold an aged merge-up note
    When the chase sweeps repeatedly while the resident finishes each drain
    Then at most one rotation is performed per sweep
    And no rotation is performed within the rotate cooldown of the previous one
    And no rotation is performed while the resident pane shows a busy footer
    And the resident returns to coder between drains
    And all five mailboxes end empty with no human action

  # BL-576 aged-note-actionability-06
  Scenario: the starved note-only mailbox drains end to end
    Given the specifier is dormant and its inbox/new holds only notes, all enqueued ten hours ago
    And the resident is idle at coder
    When the daemon sweeps
    Then the resident rotation to specifier is performed
    And ready_for_next hands the specifier its highest-priority waiting note
    And the specifier's inbox/new empties without human action

  # BL-576 aged-note-actionability-07
  Scenario Outline: a wasted resident wake is suppressed only for a note to a dormant role
    Given a <parcel_type> is delivered to a role whose pane state is <recipient_pane> while the resident is <resident_state>
    When delivery completes
    Then the resident wake is <wake>
    And the parcel is in the recipient's inbox/new

    Examples:
      | parcel_type | recipient_pane | resident_state         | wake       |
      | note        | dormant        | live as another role   | suppressed |
      | git_handoff | dormant        | live as another role   | injected   |
      | note        | dormant        | live as that same role | injected   |
      | note        | own pane       | live as another role   | injected   |
      | note        | dormant        | absent                 | injected   |

  # BL-576 aged-note-actionability-08
  Scenario: a refused aged-note rotate leaves the per-sweep wake budget for the next role
    Given the specifier holds an aged note and a rotate to it is refused by the rotate cooldown
    When the same chase sweep goes on to poke a role that has its own standing pane
    Then that poke is still performed
