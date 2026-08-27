# mutation-stamp: sha256=681124e91dc4bb918802c7abbde0dd7fddd7f3f8524a6cb7882bf31c4f19dacd
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T07:12:43.047775845Z","feature_name":"The PWA auto-translates ticket (and doc) sentences into configured locales at build time, with jargon preserved","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-230-pwa-translate-ticket-doc-sentences.feature","background_hash":"43af0102630fc45886d1f3c5a169770b85875a0133f11ccca2e1772cff038d69","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a ticket title renders translated in a configured target locale","scenario_hash":"54d12417c63a2cc2e08cfde0cbc357efc15b496a142d5ae740b75cdfd11b45ba","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-10T07:12:43.047775845Z"}]}
# acceptance-mutation-manifest-end

Feature: The PWA auto-translates ticket (and doc) sentences into configured locales at build time, with jargon preserved

  # Follow-up to BL-118. In a non-source locale the chrome is translated but the
  # ticket titles/descriptions and doc content — the English text the operator
  # authors — stay English. Operator decisions (2026-07-10): (1) "sentences have to
  # be translated; jargon terms can stay in English"; (2) mechanism is BUILD-TIME
  # AUTO-TRANSLATE; (3) DESIGN FOR N LANGUAGES, not just French. So an automated
  # pass at dashboard-build time translates source content into each configured
  # target locale, preserving jargon, and the PWA renders any configured locale —
  # French is the first delivered target, but nothing hardcodes a two-language
  # assumption. pwa/app.js already has a French-specific hook (ticketTitle returns
  # ticket.titleFr, pwa/app.js:183); this generalizes it to per-locale content.

  Background:
    Given a build-time pass that auto-translates source content into each configured target locale, preserving a defined jargon list

  # BL-230 content-translated-01
  Scenario Outline: a ticket title renders translated in a configured target locale
    Given a ticket whose source title is a prose sentence and a "<locale>" translation was produced at build time
    When the board is rendered in "<locale>"
    Then the title is shown as a sentence in that locale

    Examples:
      | locale |
      | fr     |
      | es     |

  # BL-230 jargon-preserved-02
  Scenario: jargon tokens are preserved inside the translated title
    Given a source title containing jargon such as a BL-id, a role name, or a product/tech term
    When it is shown in a target locale
    Then those jargon tokens remain in their original form within the translated sentence

  # BL-230 fallback-03
  Scenario: a missing translation falls back to the source text
    Given a ticket with no translation for the active locale
    When the board is rendered in that locale
    Then it falls back to the source text, never an error or a blank

  # BL-230 source-unchanged-04
  Scenario: the source locale shows the authored text unchanged
    Given the PWA in the source locale
    When the board is rendered
    Then ticket titles show their authored source text

  # BL-230 add-language-05
  Scenario: adding a new target locale needs no per-language code change
    Given a new target locale is added to the configured locale set
    When the dashboard is rebuilt and the PWA is opened in that locale
    Then its content is auto-translated and rendered with no code change specific to that language

# Non-behavioral gates:
#  - Build-time auto-translation (operator 2026-07-10): the pass runs at dashboard
#    build (backlogDashboard.ts) and writes per-locale content fields into
#    backlog.json — never a runtime browser call (respect the PWA offline /
#    no-localStorage / secret rules). The engine (an LLM via the swarm's existing
#    model access, or a translation API) is an architect/coder choice; jargon
#    preservation is a hard requirement, so the engine must support a preserve-list
#    (an LLM prompt fits well).
#  - N-LANGUAGE DESIGN (operator directive): generalize the French-specific hook
#    (ticketTitle titleFr; the en/fr LOCALES toggle) to an arbitrary configured
#    locale set — per-locale content keyed by locale code, and a selector listing
#    the configured locales. Adding a language is a config + translation-pass
#    operation, NOT new code (see add-language-05). FR is the first delivered target.
#  - Cost control: cache translations; only (re)translate source content that
#    changed, not every item every build.
#  - Jargon preserve-list is a defined, reviewable list (BL-ids and role names at
#    minimum), not ad hoc per translation.
#  - DELIVER IN SLICES: (1) titles, FR, at build; (2) generalize to N locales +
#    selector; (3) descriptions and docs via the same per-locale mechanism. Chrome
#    strings (locales.js) also need per-locale coverage per configured language —
#    coordinate with BL-118/BL-229.
