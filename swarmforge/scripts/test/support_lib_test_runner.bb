#!/usr/bin/env bb
;; TDD runner for support_lib.bb (BL-275) - pure assertions only (fake
;; :read-thread!/:write-thread!/:list-existing-ids! adapters, injected
;; timestamps). No real fs, no real timers, no real clock.
(ns support-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "support_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── parse-thread-number / next-thread-id (pure) ──────────────────────────

(assert= "parse-thread-number extracts the numeric part" 42 (support-lib/parse-thread-number "SUP-42"))
(assert= "parse-thread-number rejects a non-matching id" nil (support-lib/parse-thread-number "BL-42"))
(assert= "next-thread-id starts at SUP-1 when none exist yet" "SUP-1" (support-lib/next-thread-id []))
(assert= "next-thread-id continues from the highest existing number"
         "SUP-4" (support-lib/next-thread-id ["SUP-1" "SUP-3" "SUP-2"]))
(assert= "next-thread-id ignores non-matching entries rather than crashing"
         "SUP-2" (support-lib/next-thread-id ["SUP-1" "garbage"]))

;; ── new-thread / append-message (pure) — support-mvp-01/03/04 ────────────

(let [thread (support-lib/new-thread "SUP-1" "rc" "2026-07-11T09:00:00Z" "hello, need help")]
  (assert= "new-thread assigns the given id" "SUP-1" (:id thread))
  (assert= "BL-275 support-mvp-01: a new thread starts open" "open" (:status thread))
  (assert= "BL-275 support-mvp-01: the message is stored under its channel and timestamp"
           [{:channel "rc" :timestamp "2026-07-11T09:00:00Z" :text "hello, need help"}]
           (:messages thread)))

(let [opened (support-lib/new-thread "SUP-1" "rc" "2026-07-11T09:00:00Z" "hello")
      followed-up (support-lib/append-message opened "rc" "2026-07-11T09:05:00Z" "still there?")]
  (assert= "BL-275 support-mvp-03: a follow-up is appended to the same thread"
           2 (count (:messages followed-up)))
  (assert= "BL-275 support-mvp-03: the follow-up carries its own channel/timestamp/text"
           {:channel "rc" :timestamp "2026-07-11T09:05:00Z" :text "still there?"}
           (last (:messages followed-up)))
  (assert= "BL-275 support-mvp-04: appending a non-close interaction never changes status away from open"
           "open" (:status followed-up)))

;; ── record-interaction! (adapter-injected) ───────────────────────────────

(let [store (atom {})
      adapters {:read-thread! (fn [id] (get @store id))
                :write-thread! (fn [thread] (swap! store assoc (:id thread) thread))
                :list-existing-ids! (fn [] (keys @store))}
      opened (support-lib/record-interaction! nil "rc" "2026-07-11T09:00:00Z" "hello, need help" adapters)]
  (assert= "record-interaction! with no thread-id opens a new SUP-### thread" "SUP-1" (:id opened))
  (assert= "record-interaction! persists the new thread via :write-thread!" opened (get @store "SUP-1"))

  (let [followed-up (support-lib/record-interaction! "SUP-1" "rc" "2026-07-11T09:05:00Z" "still there?" adapters)]
    (assert= "record-interaction! with a thread-id appends to the SAME thread" "SUP-1" (:id followed-up))
    (assert= "record-interaction! follow-up count" 2 (count (:messages followed-up)))
    (assert= "record-interaction! persists the appended thread" followed-up (get @store "SUP-1")))

  (let [second (support-lib/record-interaction! nil "rc" "2026-07-11T09:10:00Z" "unrelated ask" adapters)]
    (assert= "record-interaction! for a SECOND caller opens a DIFFERENT thread, not the first"
             "SUP-2" (:id second))))

;; ── email echo composition (pure) — support-mvp-02 ───────────────────────

(let [thread (support-lib/new-thread "SUP-7" "rc" "2026-07-11T09:00:00Z" "my PR is stuck\nsecond line")
      echo (support-lib/assemble-email-echo thread "check the CI logs" ["retry the build" "escalate to human"])]
  (assert= "BL-275 support-mvp-02: the subject carries the ticket id" true
           (clojure.string/starts-with? (:subject echo) "[SUP-7]"))
  (assert= "BL-275 support-mvp-02: the subject carries a short title (first line of the opening message)"
           "[SUP-7] my PR is stuck" (:subject echo))
  (assert= "BL-275 support-mvp-02: the body summarizes the conversation so far" true
           (clojure.string/includes? (:body echo) "my PR is stuck"))
  (assert= "BL-275 support-mvp-02: the body states the next step" true
           (clojure.string/includes? (:body echo) "Next step: check the CI logs"))
  (assert= "BL-275 support-mvp-02: the body lists every option" true
           (and (clojure.string/includes? (:body echo) "- retry the build")
                (clojure.string/includes? (:body echo) "- escalate to human"))))

(let [long-line (apply str (repeat 80 "x"))
      thread (support-lib/new-thread "SUP-8" "rc" "2026-07-11T09:00:00Z" long-line)]
  (assert= "a long opening line is truncated in the subject, never overflowing"
           true (< (count (support-lib/build-email-subject thread)) (count long-line))))

;; ── wake decision (pure) — mirrors operator_lib.bb's should-launch-operator? ──

(assert= "should-wake-support? fires when work is pending and nothing is running"
         true (support-lib/should-wake-support? {:llm-running? false :pending-count 1}))
(assert= "should-wake-support? does not fire with nothing pending"
         false (support-lib/should-wake-support? {:llm-running? false :pending-count 0}))
(assert= "should-wake-support? does not fire while already running (never double-launch)"
         false (support-lib/should-wake-support? {:llm-running? true :pending-count 3}))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: support_lib.bb"))
