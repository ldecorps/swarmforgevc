Feature: Telegram tells the human a recert batch is waiting, and takes him to it (RETIRED)

# BL-339 RETIRED 2026-07-17 — the whole "notify + deep-link into the PWA" behaviour this
# feature specified is superseded by the recert-telegram-move epic (BL-450 build half + BL-451
# retire half), human-approved via AskUserQuestion 2026-07-16. All seven scenarios are retired;
# the durable contract for recertification now lives in the successor feature files below. Do
# NOT re-word these into the new behaviour — that would duplicate BL-450/BL-451's contract
# (one-scenario-per-behaviour / IR-DRY). This file is kept as a tombstone so BL-339's historical
# acceptance pointer stays valid and the retirement is traceable.
#
# Successor scenarios (where each retired BL-339 scenario's behaviour now lives):
#   - BL-339-01/03/04/05 (a waiting batch is announced; one message not per-scenario; not
#     re-announced every tick; nothing when empty)  ->  the notify is REMOVED by BL-451
#     retire-pwa-recert-02 ("the redundant BL-339 recert deep-link notification is no longer
#     sent"); the "post the oldest scenario, one at a time, edge-triggered, nothing when empty"
#     behaviour is now BL-450 recert-telegram-01 / -02 / -08 (specs/features/BL-450-recert-standing-telegram-topic.feature).
#   - BL-339-02/06 (the announcement deep-links into the PWA recert view; a new batch is
#     re-announced)  ->  the PWA recert view and its deep link are REMOVED by BL-451
#     retire-pwa-recert-01 ("the phone PWA no longer presents a recert view or its verbs").
#   - BL-339-07 (a verdict is still NOT accepted through Telegram)  ->  INVERTED by BL-450:
#     recert verdicts are now given in-chat. See BL-450 recert-telegram-03 (validate advances
#     the last-reviewed timestamp), -04 (amend), -05/-06 (delete). This scenario began failing
#     honestly on main the moment BL-450 wired a second confirmScenario caller
#     (recertificationStore.ts), which is why the hardener routed the stale feature here.
#
# The now-dead step handlers (specs/pipeline/steps/recertNotifySteps.js + its index.js entry)
# are TEST code that reads the notify modules BL-451 deletes — they are removed as part of
# BL-451's own reader-sweep, not here (the specifier does not edit step handlers).
