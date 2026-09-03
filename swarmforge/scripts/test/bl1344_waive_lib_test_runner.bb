#!/usr/bin/env bb
;; BL-1344 TDD runner for babysitter_waive_lib.bb — the pure read/decide half
;; of "an investigated finding can be waived". No sweep, no tmux, no clock:
;; every input is injected, exactly the babysitterd_sweep_lib runner's posture.
;;
;; The three bounds this ticket exists to keep are what the assertions are
;; weighted toward: one waive silences ONE key, only a recorded decision
;; creates one, and a store that cannot be read positively still nudges.
(ns bl1344-waive-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "babysitter_waive_lib.bb")))
(require '[babysitter-waive-lib :as w])

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg expr] (when-not expr (swap! failures conj (str "FAIL: " msg))))

(def art42-key "pipeline-code-on-main-e358e1b46e")
(def other-key "pipeline-code-on-main-b71c941a19")

(def store-text
  (str "# header comment\n\n"
       "- key: " art42-key "\n"
       "  waived_by: coordinator\n"
       "  reason: \"QA's own legitimate land, investigated 2026-09-02\"\n"
       "  waived_at: 2026-09-02\n"))

;; ── parse ────────────────────────────────────────────────────────────────
(let [{:keys [ok? waives]} (w/parse-waives store-text)]
  (assert-true "a well-formed store parses" ok?)
  (assert= "the waived key is present" #{art42-key} (set (keys waives)))
  (assert= "who waived it survives the parse" "coordinator" (:waived-by (get waives art42-key)))
  (assert= "the stated reason survives the parse"
           "QA's own legitimate land, investigated 2026-09-02" (:reason (get waives art42-key)))
  (assert= "when it was waived survives the parse" "2026-09-02" (:waived-at (get waives art42-key))))

(assert-true "an empty store is a readable store with nothing waived"
             (let [{:keys [ok? waives]} (w/parse-waives "")] (and ok? (empty? waives))))

;; A malformed store is NOT silently an empty store: an entry missing the
;; fields that make a waive accountable cannot be honoured as one.
(doseq [[label text] [["not YAML at all" "{{{ this is not a store"]
                      ["an entry with no key" "- waived_by: coordinator\n  reason: \"x\"\n"]
                      ["an entry with no reason" (str "- key: " art42-key "\n  waived_by: coordinator\n")]
                      ["an entry with no waiver" (str "- key: " art42-key "\n  reason: \"x\"\n")]]]
  (assert-true (str "malformed store rejected: " label) (false? (:ok? (w/parse-waives text)))))

;; ── decide ───────────────────────────────────────────────────────────────
(def findings [{:key art42-key :severity "CRIT" :message "pipeline code on main outside QA"}
               {:key other-key :severity "CRIT" :message "pipeline code on main outside QA"}])

(let [{:keys [to-nudge suppressed store-error]}
      (w/partition-findings findings (w/parse-waives store-text))]
  (assert= "a waived finding is held back" [other-key] (mapv :key to-nudge))
  (assert= "and is reported as suppressed, never silently dropped" [art42-key] (mapv :key suppressed))
  (assert-true "a readable store raises no store error" (nil? store-error)))

;; invariant 1: one key, one waive - a waive for a DIFFERENT key of the same
;; class suppresses nothing here.
(let [{:keys [to-nudge]} (w/partition-findings findings (w/parse-waives (str/replace store-text art42-key "some-other-key")))]
  (assert= "a waive for another key silences nothing" [art42-key other-key] (mapv :key to-nudge)))

;; invariant 3: suppression requires a positively read waive.
(doseq [[label read-result]
        [["missing store" (w/read-waive-store (str (fs/path script-dir "no-such-waive-store.yaml")))]
         ["malformed store" (w/parse-waives "{{{ not a store")]
         ["unreadable store" {:ok? false :reason :unreadable}]]]
  (let [{:keys [to-nudge suppressed]} (w/partition-findings findings read-result)]
    (assert= (str "every finding still nudges with a " label) [art42-key other-key] (mapv :key to-nudge))
    (assert= (str "nothing is suppressed by a " label) [] (mapv :key suppressed))))

(assert-true "an unreadable store is reported as a store error"
             (some? (:store-error (w/partition-findings findings {:ok? false :reason :unreadable}))))
(assert-true "a missing store is not an error - there is simply nothing waived"
             (nil? (:store-error (w/partition-findings findings (w/read-waive-store "/definitely/not/here.yaml")))))

;; ── record ───────────────────────────────────────────────────────────────
;; invariant 2: recording is an explicit act with an accountable author and
;; reason; nothing here can be produced by a sweep's own classification.
(let [{:keys [waives]} (w/parse-waives store-text)
      recorded (w/record-waive waives {:key other-key :waived-by "human" :reason "hand-merge, root-caused at 3310a24dfb" :waived-at "2026-09-03"})]
  (assert= "recording adds exactly one key" #{art42-key other-key} (set (keys recorded)))
  (assert= "the new waive keeps its author" "human" (:waived-by (get recorded other-key)))
  (assert= "the existing waive is untouched" "coordinator" (:waived-by (get recorded art42-key))))

(doseq [[label bad] [["a blank key" {:key "" :waived-by "human" :reason "why"}]
                     ["no waiver" {:key other-key :waived-by "" :reason "why"}]
                     ["no reason" {:key other-key :waived-by "human" :reason "  "}]]]
  (assert-true (str "recording refuses " label)
               (try (w/record-waive {} bad) false (catch Exception _ true))))

;; A round trip is lossless: what is recorded can be read back and listed.
(let [rendered (w/render-waives (w/record-waive {} {:key art42-key :waived-by "coordinator" :reason "investigated: legitimate" :waived-at "2026-09-03"}))
      {:keys [ok? waives]} (w/parse-waives rendered)]
  (assert-true "a rendered store parses" ok?)
  (assert= "the round trip keeps the reason" "investigated: legitimate" (:reason (get waives art42-key))))

;; ── list ─────────────────────────────────────────────────────────────────
;; scenario 05: a waive is discoverable - key, waiver and reason, never a
;; silent deletion.
(let [lines (w/format-waive-listing (:waives (w/parse-waives store-text)))]
  (assert= "one line per waive" 1 (count lines))
  (assert-true "the listing names the key" (str/includes? (first lines) art42-key))
  (assert-true "the listing names who waived it" (str/includes? (first lines) "coordinator"))
  (assert-true "the listing names the reason" (str/includes? (first lines) "investigated 2026-09-02")))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "ALL PASS: BL-1344 babysitter waive lib"))
