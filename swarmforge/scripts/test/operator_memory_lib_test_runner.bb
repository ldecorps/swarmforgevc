#!/usr/bin/env bb
;; TDD runner for operator_memory_lib.bb (BL-282) - pure assertions only
;; (fake :read-store!/:write-store! adapters). No real fs, no real LLM, no
;; real timers.
(ns operator-memory-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_memory_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── append-facts (pure) — operator-memory-01/05 ──────────────────────────

(assert= "empty-memory-store starts with no facts" {:facts []} (operator-memory-lib/empty-memory-store))

(assert= "append-facts adds a new fact to an empty store"
         {:facts ["the human prefers terse replies"]}
         (operator-memory-lib/append-facts (operator-memory-lib/empty-memory-store) ["the human prefers terse replies"]))

(assert= "BL-282 operator-memory-05: re-appending an already-known fact does not duplicate it"
         {:facts ["fact A"]}
         (operator-memory-lib/append-facts {:facts ["fact A"]} ["fact A"]))

(assert= "append-facts appends a NEW distinct fact alongside an existing one, order-preserving"
         {:facts ["fact A" "fact B"]}
         (operator-memory-lib/append-facts {:facts ["fact A"]} ["fact B"]))

(assert= "append-facts dedups WITHIN a single proposed batch too"
         {:facts ["fact A"]}
         (operator-memory-lib/append-facts (operator-memory-lib/empty-memory-store) ["fact A" "fact A"]))

;; ── facts-for-wake (pure) — operator-memory-02 ───────────────────────────

(assert= "facts-for-wake returns every stored fact (MVP: no ranking)"
         ["fact A" "fact B"]
         (operator-memory-lib/facts-for-wake {:facts ["fact A" "fact B"]}))

(assert= "facts-for-wake on an empty store returns an empty list, not an error"
         [] (operator-memory-lib/facts-for-wake (operator-memory-lib/empty-memory-store)))

;; ── distill-facts! (adapter-injected) — operator-memory-01 ───────────────

(let [store (atom (operator-memory-lib/empty-memory-store))
      adapters {:read-store! (fn [] @store) :write-store! (fn [s] (reset! store s))}
      result (operator-memory-lib/distill-facts! ["the human's timezone is UTC+1"] adapters)]
  (assert= "distill-facts! persists the proposed fact via :write-store!"
           {:facts ["the human's timezone is UTC+1"]} @store)
  (assert= "distill-facts! returns the updated store" @store result))

;; BL-282 operator-memory-01: a fact distilled in one "run" (one adapters
;; closure over the SAME backing atom, simulating one disposable Operator
;; process) is available in a LATER run (a fresh call against the SAME
;; persisted store, simulating the disposable LLM's death + restart).
(let [store (atom (operator-memory-lib/empty-memory-store))
      adapters {:read-store! (fn [] @store) :write-store! (fn [s] (reset! store s))}]
  (operator-memory-lib/distill-facts! ["prefers async updates"] adapters)
  ;; A "later run" just re-reads the SAME backing store - proving
  ;; persistence is the store's job, not the (now-dead) first run's memory.
  (assert= "BL-282 operator-memory-01: a fact distilled by an earlier run is present for a later run"
           ["prefers async updates"] (operator-memory-lib/facts-for-wake ((:read-store! adapters)))))

;; distilling the SAME fact again via distill-facts! (not just append-facts
;; directly) stays idempotent end-to-end through the adapter seam too.
(let [store (atom {:facts ["fact A"]})
      adapters {:read-store! (fn [] @store) :write-store! (fn [s] (reset! store s))}]
  (operator-memory-lib/distill-facts! ["fact A"] adapters)
  (assert= "BL-282 operator-memory-05: distill-facts! stays idempotent for a re-distilled fact"
           {:facts ["fact A"]} @store))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: operator_memory_lib.bb"))
