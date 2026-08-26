Feature: a recurring failure-mode audit inventories what agents keep tripping on and emits a fix-ticket slate

  # Operator INTAKE (2026-07-17, relayed from a Telegram question): "run a ticket to fix the
  # recurring loose ends / errors the various swarm agents keep tripping on — a hardening pass that
  # inventories the repeated failure modes across agents (merge/phantom-revert races, stale-build
  # gotchas, dropped handoff notes, blocked-menu stalls, etc.) and fixes the root causes."
  # Human decision (confirmed 2026-07-17): AUDIT-FIRST — one bounded ticket produces an
  # evidence-backed inventory and a PRIORITIZED SLATE of root-cause fix tickets; the actual fixes
  # are separate follow-on tickets the specifier files from the audit's findings. This framing was
  # chosen because the failure modes are heterogeneous: many canonical ones are ALREADY root-caused
  # and fixed (phantom-revert BL-373, socket-glob BL-367, corrupt-handoff BL-365), so the audit's
  # first job is to separate genuinely-open defects from already-fixed noise, not to re-fix.
  #
  # WHY audit-then-fix, not fix-directly: you cannot fix what you have not inventoried, and roughly
  # half the "recurring" modes are already closed. A single "fix all the loose ends" ticket is
  # unbounded and unshippable; the audit turns it into a ranked, evidence-cited list of concrete,
  # orthogonal fix tickets the coordinator can pull.
  #
  # Verified evidence sources (all durable, on this host; the audit reads these, not memory alone):
  #  - .swarmforge/rule_proposals/<month>.jsonl  (structured: scope/body/rationale/proposer) — every
  #    rule an agent proposed because it saw a pattern worth preventing.
  #  - .swarmforge/qa_bounces/<month>.jsonl        (structured QA-bounce telemetry).
  #  - backlog/evidence/*.md (111 files) + their commit subjects (git log main -- backlog/evidence/)
  #    — QA/architect bounce write-ups, the richest per-incident record.
  #  - git revert/bounce history on main (revert subjects, "BOUNCE" evidence commits).
  #  - .swarmforge/telemetry/chaser-*.jsonl (chase/nudge/stall telemetry).
  #  - the operator memory catalog (MEMORY.md) as a cross-check, never as the sole citation.
  #
  # Non-behavioral gates:
  #  - The testable core is a REPRODUCIBLE, PURE scan over the STRUCTURED/countable sources
  #    (rule_proposals + qa_bounces jsonl, evidence-commit subjects): it groups records by failure
  #    signature and counts occurrences, deterministically, with no network and no clock dependence.
  #    Its input paths are INJECTED so it is tested against fixtures, never the repo-root .swarmforge/
  #    sibling (Stryker sandbox rule) and never the live evidence tree.
  #  - The human-readable audit document is the JUDGMENT layer over that scan: classification
  #    (already-fixed / open-code / operational) is specifier/architect judgment, cited to real
  #    records; the doc never invents a mode with no evidence.
  #  - This ticket does NOT perform the fixes. Its deliverable is the inventory + the enumerated
  #    proposed fix tickets; each open-code fix is a separate, later parcel.

  # BL-512 evidence-backed-inventory-01
  Scenario: every inventoried mode cites a real durable evidence record
    Given the durable failure-mode evidence sources
    When the audit inventory is produced
    Then each recurring mode it lists cites at least one real record from those sources
    And no mode is listed that has no supporting evidence

  # BL-512 signatures-grouped-with-count-02
  Scenario: repeated occurrences of one signature are grouped into a single counted mode
    Given several evidence records describing the same failure signature
    When the inventory scan runs
    Then those records are grouped into one mode carrying an occurrence count
    And the mode is not listed once per record

  # BL-512 classified-with-disposition-03
  Scenario Outline: each mode is classified and carries the disposition its class requires
    Given an inventoried failure mode classified as <classification>
    When the audit is finalized
    Then the mode carries <disposition>

    Examples:
      | classification | disposition                                 |
      | already-fixed  | the ticket or commit that resolved it       |
      | open-code      | a root cause and one proposed fix ticket    |
      | operational    | a guardrail or operator-procedure change    |

  # BL-512 open-modes-become-ranked-fix-slate-04
  Scenario: the open-code modes are emitted as distinct proposed fix tickets, ranked
    Given the classified inventory
    When the audit is finalized
    Then every open-code mode appears as a distinct proposed fix ticket
    And the proposed fix tickets are ranked by occurrence frequency and impact

  # BL-512 scan-is-reproducible-05
  Scenario: the structured-evidence scan is deterministic over its inputs
    Given a fixed set of structured evidence records
    When the inventory scan runs twice over the same inputs
    Then it produces the identical grouped counts both times
    And it makes no network call and reads no wall clock

  # BL-512 no-evidence-no-mode-06
  Scenario: a signature with no matching evidence yields no mode rather than an empty entry
    Given an evidence source that holds no record for a given signature
    When the inventory scan runs
    Then no mode is emitted for that signature
