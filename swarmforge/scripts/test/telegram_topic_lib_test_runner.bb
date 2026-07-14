#!/usr/bin/env bb
;; TDD runner for telegram_topic_lib.bb (BL-281, reshaped bridge-client
;; architecture) - pure assertions only (fake adapters). No real fs, no
;; real network, no real timers.
(ns telegram-topic-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "telegram_topic_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── select-dispatch-batch (pure) — telegram-topic-04 ─────────────────────

(assert= "select-dispatch-batch: with no telegram events, dispatch is everything, deferred is empty"
         {:dispatch [{:type "SWARM_CHECK_TIMER"}] :deferred []}
         (telegram-topic-lib/select-dispatch-batch [{:type "SWARM_CHECK_TIMER"}]))

(let [events [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}
              {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-2"}
              {:type "SWARM_CHECK_TIMER"}]
      result (telegram-topic-lib/select-dispatch-batch events)]
  (assert= "select-dispatch-batch: only the OLDEST telegram thread's events dispatch"
           [{:type "SWARM_CHECK_TIMER"} {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}]
           (:dispatch result))
  (assert= "select-dispatch-batch: the other thread's events are deferred, not dropped"
           [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-2"}]
           (:deferred result)))

(let [events [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}
              {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}]
      result (telegram-topic-lib/select-dispatch-batch events)]
  (assert= "select-dispatch-batch: multiple messages for the SAME thread all dispatch together (no bleed within one subject)"
           2 (count (:dispatch result)))
  (assert= "select-dispatch-batch: nothing deferred when only one thread is pending" [] (:deferred result)))

;; ── select-front-desk-dispatch-batch (pure) — BL-334 restricted-front-desk-
;;    operator-06: the front-desk Operator has no authority over non-human-
;;    facing events at all, so it claims ONLY TELEGRAM_TOPIC_MESSAGE events
;;    (at most one subject, same "oldest thread first" ordering as
;;    select-dispatch-batch) and leaves EVERY other pending event - including
;;    other Telegram subjects - completely untouched for the full Operator's
;;    own normal path once it is free ────────────────────────────────────────

(assert= "select-front-desk-dispatch-batch: no telegram events at all -> nothing to dispatch"
         {:dispatch [] :remaining [{:type "SWARM_CHECK_TIMER"}]}
         (telegram-topic-lib/select-front-desk-dispatch-batch [{:type "SWARM_CHECK_TIMER"}]))

(let [events [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}
              {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-2"}
              {:type "SWARM_CHECK_TIMER"}]
      result (telegram-topic-lib/select-front-desk-dispatch-batch events)]
  (assert= "select-front-desk-dispatch-batch: only the OLDEST telegram thread's events dispatch"
           [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}]
           (:dispatch result))
  (assert= "select-front-desk-dispatch-batch: non-human-facing events are left untouched, not claimed"
           [{:type "SWARM_CHECK_TIMER"} {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-2"}]
           (:remaining result)))

(let [events [{:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}
              {:type "TELEGRAM_TOPIC_MESSAGE" :subject "SUP-1"}]
      result (telegram-topic-lib/select-front-desk-dispatch-batch events)]
  (assert= "select-front-desk-dispatch-batch: multiple messages for the SAME thread dispatch together"
           2 (count (:dispatch result)))
  (assert= "select-front-desk-dispatch-batch: nothing left over when only one thread is pending"
           [] (:remaining result)))

;; ── reply-context-for (adapter-injected) — telegram-topic-03 / -04 ───────

(let [threads {"SUP-1" {:id "SUP-1" :status "open" :messages [{:channel "telegram" :timestamp "2026-07-11T09:00:00Z" :text "about A"}]}
               "SUP-2" {:id "SUP-2" :status "open" :messages [{:channel "telegram" :timestamp "2026-07-11T09:00:00Z" :text "about B"}]}}
      reads (atom [])
      adapters {:read-thread! (fn [id] (swap! reads conj id) (get threads id))}
      context (telegram-topic-lib/reply-context-for "SUP-1" adapters)]
  (assert= "BL-281 telegram-topic-03: the reply context is that thread's OWN transcript"
           (get threads "SUP-1") context)
  (assert= "BL-281 telegram-topic-04: exactly ONE thread was read - never the other subject's"
           ["SUP-1"] @reads)
  (assert= "BL-281 telegram-topic-04: subject A's context never contains subject B's text"
           false (clojure.string/includes? (str context) "about B")))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: telegram_topic_lib.bb"))
