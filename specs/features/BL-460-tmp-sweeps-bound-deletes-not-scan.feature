# mutation-stamp: sha256=133455cb45cca2d8e7eee90e4268dd22615d7418a81e21e2f0c1f23ee694c07c
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T19:02:51.288735437Z","feature_name":"the /tmp sweeps bound deletes per tick, make progress past non-reapable entries, and report what they do","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-460-tmp-sweeps-bound-deletes-not-scan.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a reapable entry ordered after the per-tick cap is still removed by the \"<sweep>\" sweep","scenario_hash":"d115663aa0dd3b4632cb32f25b7bec701f3c0ca6262636262769cb192d117392","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-16T19:01:50.170805081Z"},{"index":1,"name":"the \"<sweep>\" sweep bounds DELETES per tick, not the scan","scenario_hash":"00926f5c0a8b4c075f3e0f2ff5337be2aa94841ff29c1321d225476df8d52a28","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-16T19:01:50.170805081Z"},{"index":2,"name":"the reworked windowing still removes only entries the predicate allows","scenario_hash":"83275cf6dd3e4fde7d6ed6317896dca6986c1969243ac472a02585a642e97118","mutation_count":10,"result":{"Total":10,"Killed":10,"Survived":0,"Errors":0},"tested_at":"2026-07-16T19:01:50.170805081Z"},{"index":5,"name":"a newly-observed fixture prefix is recognised as a known fixture","scenario_hash":"3238006590cf9a2e239584819ad3eb21b26b2c464dd5289422718e19bd0a326f","mutation_count":7,"result":{"Total":7,"Killed":7,"Survived":0,"Errors":0},"tested_at":"2026-07-16T19:01:50.170805081Z"}]}
# acceptance-mutation-manifest-end

Feature: the /tmp sweeps bound deletes per tick, make progress past non-reapable entries, and report what they do

  # BL-413 (stale-sandbox dir sweep, operator_runtime.bb sandbox-sweep!) and
  # BL-458 (orphan-process reaper, fixture_reaper_sweep_lib.bb sweep!) both ship
  # `(doseq [name (take cap (list-entries root))] ...)` — they examine only the
  # FIRST `cap` (default 100) entries of /tmp in raw readdir order every tick,
  # and the window only advances when entries INSIDE it are deleted. Verified
  # live: of /tmp's first 100 readdir entries 0 were reapable (5 fresh matches,
  # 95 non-matching), so both sweeps re-scanned the same 100 non-reapable entries
  # forever — 76 orphan processes untouched at 21h, /tmp GROWING +21/min, zero
  # log lines. It is a bounded SCAN where the design needed bounded DELETES.
  # The pure decision predicates (removable?/reapable?) are correct — the defect
  # is entirely in the windowing. This feature pins the shared windowing contract
  # for BOTH sweeps; a fresh /tmp or a live swarm must NEVER be reached in tests.

  # BL-460 tmp-sweep-bounded-deletes-01
  Scenario Outline: a reapable entry ordered after the per-tick cap is still removed by the "<sweep>" sweep
    Given a fixture root whose listing places more non-reapable entries than the per-tick cap before a reapable entry
    When the "<sweep>" sweep runs for enough ticks to cover the listing
    Then that reapable entry beyond the cap is removed

    Examples:
      | sweep          |
      | stale-dir      |
      | orphan-process |

  # BL-460 tmp-sweep-bounded-deletes-02
  Scenario Outline: the "<sweep>" sweep bounds DELETES per tick, not the scan
    Given a fixture root where the count of reapable entries exceeds one tick's delete cap
    When the "<sweep>" sweep runs one tick
    Then at most the per-tick cap of entries are removed
    And the remaining reapable entries are removed on subsequent ticks

    Examples:
      | sweep          |
      | stale-dir      |
      | orphan-process |

  # BL-460 tmp-sweep-bounded-deletes-03
  Scenario Outline: the reworked windowing still removes only entries the predicate allows
    Given a scanned fixture root entry that is "<kind>"
    When the sweep evaluates it
    Then the entry is removed is "<removed>"

    Examples:
      | kind                                 | removed |
      | a stale idle known fixture           | yes     |
      | a fresh known fixture                | no      |
      | an unknown-prefix entry              | no      |
      | the live swarm socket root           | no      |
      | a stale known fixture with a live process | no |

  # BL-460 tmp-sweep-bounded-deletes-04
  Scenario: a sweep tick that reaps at least one entry logs a summary line
    Given a sweep tick that removes one or more entries
    When the tick completes
    Then it logs a summary line reporting how many entries it reaped

  # BL-460 tmp-sweep-bounded-deletes-05
  Scenario: a sweep that keeps finding nothing reports periodically, not every tick
    Given consecutive sweep ticks that scan entries and remove none
    When the ticks run
    Then a scanned-nothing line is logged periodically rather than on every tick

  # BL-460 tmp-sweep-bounded-deletes-06
  Scenario Outline: a newly-observed fixture prefix is recognised as a known fixture
    Given a /tmp entry whose name begins with "<prefix>"
    When the allowlist classifies the entry
    Then it is a known fixture is "yes"

    Examples:
      | prefix                             |
      | atomic-test-                       |
      | render-briefing-diagrams-test-     |
      | propose-onboarding-prompts-target- |
      | live-ticket-files-                 |
      | chase-trend-test-                  |
      | negotiate-onboarding-contract-target- |
      | provision-onboarding-telegram-channel-test- |
