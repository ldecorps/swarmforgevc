Feature: The PWA recert view and the redundant BL-339 recert notify are retired once recert lives in Telegram

  # BL-451 (feature, human-requested via Operator/Telegram 2026-07-16): the RETIRE half of the
  # "move recert fully out of the PWA" directive. BL-450 moves Gherkin recertification into a
  # standing Recert Telegram topic (validate/amend/delete in-chat). Once that loop is live, the
  # PWA recert view is redundant AND its supporting notify is dead:
  #   - The PWA's recert card + Confirm/Update/Delete mailto verbs (pwa/app.js renderRecertContent /
  #     recertMailtoHref, the BL-271 Listen-on-recert control, the BL-280 backlog-context on that
  #     card, and the pwa/locales.js recert strings) become the surface the human explicitly asked
  #     to move OFF of.
  #   - BL-339's "a recert batch is waiting — tap to open the PWA" notification (notify-recert-batch.ts /
  #     recertBatchNotifier.ts, the handoffd.bb recert-notify-sweep!, recert-notify-state.json, and the
  #     buildRecertDeepLink #recert=1 link) deep-links INTO the PWA recert view being removed, so its
  #     link target 404s — it must be retired, not left pointing at a deleted surface.
  #   - The recert-batch.json publish (backlog-dashboard.yml) and generate-recert-batch CLI exist ONLY
  #     to feed the PWA recert view; BL-450 reads computeRecertBatch server-side, not the published
  #     artifact. Remove the now-readerless artifact/publish too, but VERIFY BY GREP that nothing else
  #     reads recert-batch.json before deleting (engineering call-site-sweep rule); KEEP computeRecertBatch
  #     and the recert store modules — BL-450 depends on them.
  #
  # This ticket removes DEAD/redundant surfaces only; it must not remove the recert store modules the
  # Telegram loop uses. It depends on BL-450 landing first (do not remove the old path before the new one
  # works). Scope is verified by grep at build time; the scenarios below fix the observable outcome.

  # BL-451 retire-pwa-recert-01
  Scenario: The phone PWA no longer presents a recert view or its verbs
    Given scenarios need recertification
    When the phone PWA is loaded
    Then the PWA does not render a recert view
    And the PWA offers no confirm, update, or delete recert control

  # BL-451 retire-pwa-recert-02
  Scenario: The redundant BL-339 recert deep-link notification is no longer sent
    Given a recert batch is waiting on the human
    When the recert notify sweep runs
    Then no recert-batch-waiting deep-link message is sent to Telegram

  # BL-451 retire-pwa-recert-03
  Scenario: Recertification is still reachable, now in the Recert Telegram topic
    Given scenarios need recertification
    When the recert posting runs
    Then a scenario is presented for recertification in the Recert Telegram topic
