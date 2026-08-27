Feature: record bounces by bouncing role and report the rework metric

  The durable bounce log (BL-454) measures the wrong half of rework: its
  writer is invoked from QA.prompt alone, and all 53 live records lack a
  `by` field — the QA invocation passes --by since BL-608, but only the
  ticket YAML merge receives it, never the JSONL record. Architect
  send-backs, where repeated bouncing actually happens (BL-590: 4, BL-606: 3,
  none recorded anywhere), are invisible. This slice generalises the recorder
  to record-bounce with a REQUIRED bouncing-role parameter written to BOTH
  stores, wires every reviewing role's send-back procedure to call it, keeps
  the 53 legacy records readable as unattributed, and reports the resulting
  rework metric on the briefing flow-balance line split by bouncing role —
  sourced from the durable log, never commit subjects, with absence of data
  rendered as unavailable, never zero.

  # BL-635 record-bounce-by-role-01
  Scenario: recording a bounce writes the bouncing role to both durable stores
    Given an active ticket fixture with no recorded bounces
    When record-bounce records a bounce with bouncing role architect blaming coder with an evidence path
    Then the appended durable log record carries by architect
    And the durable log record still blames coder as the producing role
    And the ticket record gains a bounce_history entry with by architect and blamed coder
    And the ticket bounce_count equals 1

  # BL-635 record-bounce-by-role-02
  Scenario: invoking record-bounce without a bouncing role fails loudly and writes nothing
    Given an active ticket fixture with no recorded bounces
    When record-bounce is invoked without the by flag
    Then the invocation fails with a usage error naming the missing by flag
    And no durable log record is written
    And the ticket record is unchanged

  # BL-635 record-bounce-by-role-03
  Scenario: an unknown bouncing role value is rejected before anything is written
    Given an active ticket fixture with no recorded bounces
    When record-bounce is invoked with the misspelt bouncing role hardener
    Then the invocation fails naming the valid bouncing role set
    And no durable log record is written

  # BL-635 record-bounce-by-role-04
  Scenario: four architect send-backs on one ticket end with bounce_count four
    Given an active ticket fixture with no recorded bounces
    When record-bounce records four bounces by architect each citing a distinct bounced commit
    Then the ticket bounce_count equals 4
    And the ticket bounce_history holds four entries each with by architect
    And the durable log holds four records for the ticket each with by architect

  # BL-635 record-bounce-by-role-05
  Scenario: the reviewing role prompts instruct recording send-backs with their own role as bouncer
    Given the pipeline role prompts
    Then the architect prompt send-back procedure instructs running record-bounce with by architect and an evidence path
    And the QA prompt bounce procedure invokes record-bounce with by QA
    And each of the cleaner hardender documenter and specifier prompts names the record-bounce step for its own send-backs

  # BL-635 record-bounce-by-role-06
  Scenario: legacy by-less records stay readable and aggregate as unattributed
    Given a legacy qa_bounces log containing a record without a by field
    And a generalised bounce log containing a record with by QA
    When the bounce records are read
    Then both records are returned
    And the by-less record is attributed as unattributed
    And the by-less record is not attributed to QA

  # BL-635 record-bounce-by-role-07
  Scenario: the recorder writes new records to the generalised log path
    Given an active ticket fixture with no recorded bounces
    When record-bounce records a bounce with bouncing role QA blaming coder with an evidence path
    Then the record is appended to the generalised bounces log
    And the legacy qa_bounces log is not written

  # BL-635 record-bounce-by-role-08
  Scenario: the briefing sidecar carries rework rounds per close split by bouncing role
    Given a bounce log holding four architect bounces and two QA bounces within the current window
    And two tickets closed within the same window
    When the cost health sidecar is computed
    Then flow balance carries architect rework rounds per close of 2.0 as a trended number
    And flow balance carries QA rework rounds per close of 1.0 as a trended number
    And flow balance carries bounces per day split by bouncing role
    And no flow balance figure pools architect and QA bounces into one number

  # BL-635 record-bounce-by-role-09
  Scenario: the markdown briefing renders the rework metric on the flow balance line
    Given a computed sidecar whose flow balance carries the rework metric
    When the markdown briefing is rendered
    Then the flow balance line includes the rework rounds per close figure with a trend arrow
    And the rework figure is split by bouncing role consistent with the specced and closed figures

  # BL-635 record-bounce-by-role-10
  Scenario: the metric reads the durable log and never commit subjects
    Given a ticket titled with the word bounce having zero recorded bounces
    And a ticket with one recorded bounce whose fix produced six merge commits mentioning bounce
    When the rework metric is computed
    Then the title-contaminated ticket contributes zero rounds
    And the six-merge-commit ticket contributes exactly one round

  # BL-635 record-bounce-by-role-11
  Scenario: a repeated-bounce ticket is distinguishable from several once-bounced tickets
    Given a bounce log where one ticket has four architect bounces and four tickets have one QA bounce each
    When the rework metric is computed
    Then the metric carries a max-rounds indicator naming the four-bounce ticket with rounds 4

  # BL-635 record-bounce-by-role-12
  Scenario: a bounce-free day is zero but a pre-epoch day is unavailable
    Given a by-attributed recording epoch of 2026-07-26
    And a bounce log with no records on the day after the epoch
    When the daily rework series is computed
    Then the day after the epoch reports zero bounces
    And every day before the epoch reports unavailable rather than zero
    And the markdown rendering shows the pre-epoch period as unavailable never as a flat zero line

  # BL-635 record-bounce-by-role-13
  Scenario Outline: known architect send-back fixtures land in their days attributed to the architect
    Given a bounce log fixture holding <rounds> architect bounces for <ticket> dated <date>
    When the daily rework series is computed
    Then the series for <date> shows <rounds> bounces attributed to the architect

    Examples:
      | ticket | date       | rounds |
      | BL-590 | 2026-07-25 | 4      |
      | BL-606 | 2026-07-23 | 3      |

  # BL-635 record-bounce-by-role-14
  Scenario: the briefing bounce line reports who bounced as well as whose work
    Given a bounce log holding records with by QA and by architect and one legacy by-less record
    When the briefing bounce line is rendered
    Then the line breaks bounces down by bouncing role
    And the legacy record is shown as unattributed
    And the line no longer frames every bounce as a QA bounce
