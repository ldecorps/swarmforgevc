Feature: One decode slot on the host, held by a seat across its burst
  Ollama on the 16 GB card serves one completion at a time, first come
  first served, and iq3's cache cannot rewind to a shared prefix (BL-1978):
  whenever the next completion comes from a different seat, the whole
  prompt is processed again - 23-38 s at 20-30k tokens, 66 s at 50k
  (serve.log, 2026-10-08), against 4-7 s for a cached turn. Seats taking
  turns per request would pay that on nearly every request. The shim now
  holds one decode slot for one seat at a time: the seat keeps it while it
  keeps asking, gives it up when it goes quiet past an idle grace (tests,
  git, any tool) or has held it past a hold quantum while another seat
  waits, and a seat waiting for the slot is kept alive until its turn.
  A seat is a pane: a pack that rotates its roles through one pane is one
  seat to the slot, whichever role it is running. Builds on BL-2076's seat
  names.

  Background:
    Given a tool-call shim with one decode slot in front of a fake Ollama that answers only when the test releases it

  # BL-2077 other-seat-waits-01
  Scenario: a completion from another seat waits while one seat holds the slot
    Given seat "coder" has a chat completion in flight
    When seat "QA" sends a chat completion
    Then QA's completion has not reached the fake Ollama
    And the shim's health names coder as holding the slot and QA as waiting

  # BL-2077 quiet-holder-hands-over-02
  Scenario: a holder that goes quiet past the idle grace hands the slot to the waiting seat
    Given seat "coder" has held the slot for less than the hold quantum and seat "QA" is waiting
    When coder's completion is answered and coder sends nothing for longer than the idle grace
    Then QA's completion reaches the fake Ollama
    And the shim log records how long QA waited for the slot

  # BL-2077 holder-asks-again-03
  Scenario Outline: a holder that asks again within the idle grace keeps the slot until its hold quantum is spent
    Given seat "coder" has held the slot for <held> the hold quantum and seat "QA" is waiting
    When coder's completion is answered and coder sends its next one within the idle grace
    Then <first> reaches the fake Ollama before <second>

    Examples:
      | held          | first                    | second                   |
      | less than     | coder's next completion  | QA's completion          |
      | longer than   | QA's completion          | coder's next completion  |

  # BL-2077 waiting-stream-kept-alive-04
  Scenario: a streamed completion that waits for the slot is kept alive until its turn
    Given seat "coder" has a chat completion in flight
    When seat "QA" sends a streamed chat completion
    Then QA receives keepalive comments while it waits
    And QA receives its reply after coder hands over the slot

  # BL-2077 rotation-in-one-pane-is-one-seat-05
  Scenario Outline: a role rotated into the same pane gets the slot at once, a role in another pane waits out the idle grace
    Given a <pack> pack on which the coder's chat completion, sent to the URL swarmforge.sh works out for the coder, has just been answered
    When the cleaner sends a chat completion to the URL swarmforge.sh works out for the cleaner on that pack
    Then the cleaner's completion reaches the fake Ollama <when> the idle grace runs out
    And the shim's health names cleaner as holding the slot with no seat waiting

    Examples:
      | pack     | when   |
      | rotating | before |
      | standing | after  |
