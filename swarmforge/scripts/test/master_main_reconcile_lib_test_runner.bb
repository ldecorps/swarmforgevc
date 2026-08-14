#!/usr/bin/env bb
;; TDD runner for master_main_reconcile_lib.bb (BL-891) - no real git
;; process, no real clock, no real network (every adapter is a fake).
;; Mirrors push_sweep_lib_test_runner.bb's own assert-battery shape.

(ns master-main-reconcile-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_main_reconcile_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── reconcile-decision ──────────────────────────────────────────────────

(assert= "reconcile-decision: nothing behind -> up-to-date, regardless of dirty tree"
         :up-to-date (master-main-reconcile-lib/reconcile-decision {:behind 0 :clean? false}))
(assert= "reconcile-decision: nothing behind, clean -> up-to-date"
         :up-to-date (master-main-reconcile-lib/reconcile-decision {:behind 0 :clean? true}))
(assert= "reconcile-decision: behind, dirty tree -> dirty-blocked"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision {:behind 5 :clean? false}))
(assert= "reconcile-decision: behind, clean tree -> should-reconcile"
         :should-reconcile (master-main-reconcile-lib/reconcile-decision {:behind 5 :clean? true}))
(assert= "reconcile-decision: nil counts default to 0 -> up-to-date"
         :up-to-date (master-main-reconcile-lib/reconcile-decision {:clean? true}))

;; ── drift-report ────────────────────────────────────────────────────────

(assert= "drift-report: passes both counts through"
         {:ahead 8 :behind 22} (master-main-reconcile-lib/drift-report {:ahead 8 :behind 22}))
(assert= "drift-report: nil counts default to 0"
         {:ahead 0 :behind 0} (master-main-reconcile-lib/drift-report {}))

;; ── surface-message / surface-draft-lines ──────────────────────────────

(let [msg (master-main-reconcile-lib/surface-message {:behind 22 :reason :dirty})]
  (assert-true "surface-message: dirty reason mentions behind count" (clojure.string/includes? msg "22"))
  (assert-true "surface-message: dirty reason mentions dirty tree" (clojure.string/includes? msg "dirty"))
  (assert-true "surface-message: stays within the 80-char note limit" (<= (count msg) 80)))

(let [msg (master-main-reconcile-lib/surface-message {:behind 3 :reason :conflict})]
  (assert-true "surface-message: conflict reason mentions conflict" (clojure.string/includes? msg "conflict"))
  (assert-true "surface-message: stays within the 80-char note limit" (<= (count msg) 80)))

(assert= "surface-draft-lines: a note to the coordinator, priority 00"
         ["type: note" "to: coordinator" "priority: 00" "message: hello"]
         (master-main-reconcile-lib/surface-draft-lines "hello"))

;; ── sweep! (adapter-injected orchestration, real state-file fixture) ────

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-master-main-reconcile-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn mk-adapters
  "Every call is recorded so a test can assert not just the LOGGED outcome
   but which adapters actually fired - the property this whole ticket
   exists to guarantee is about what gets CALLED, not just what gets said."
  [{:keys [ahead behind clean? merge-result]}]
  (let [calls (atom {:rev-counts! 0 :clean? 0 :merge! 0 :surface! 0})
        logs (atom [])
        surfaced (atom [])]
    {:calls calls
     :logs logs
     :surfaced surfaced
     :adapters
     {:rev-counts! (fn [] (swap! calls update :rev-counts! inc) {:ahead ahead :behind behind})
      :clean? (fn [] (swap! calls update :clean? inc) clean?)
      :merge! (fn [] (swap! calls update :merge! inc) merge-result)
      :surface! (fn [msg] (swap! calls update :surface! inc) (swap! surfaced conj msg))
      :log! (fn [& parts] (swap! logs conj (clojure.string/join " " parts)))}}))

;; up-to-date: merge! and surface! are never called
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 0 :clean? true})]
  (master-main-reconcile-lib/sweep! (mk-tmp) adapters)
  (assert= "sweep!: up-to-date never calls merge!" 0 (:merge! @calls))
  (assert= "sweep!: up-to-date never calls surface!" 0 (:surface! @calls)))

;; dirty-blocked: merge! is NEVER called (invariant 1: never touches a
;; dirty tree), surface! IS called exactly once, naming the reason
(let [{:keys [calls surfaced adapters]} (mk-adapters {:ahead 3 :behind 22 :clean? false})]
  (master-main-reconcile-lib/sweep! (mk-tmp) adapters)
  (assert= "sweep!: dirty-blocked never calls merge!" 0 (:merge! @calls))
  (assert= "sweep!: dirty-blocked surfaces exactly once" 1 (:surface! @calls))
  (assert-true "sweep!: dirty-blocked surfaced message names the behind count"
               (clojure.string/includes? (first @surfaced) "22")))

;; dirty-blocked repeated: a SECOND tick with the SAME reason does not
;; re-surface (avoid spamming the coordinator every poll cycle)
(let [dir (mk-tmp)
      {:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 22 :clean? false})]
  (master-main-reconcile-lib/sweep! dir adapters)
  (master-main-reconcile-lib/sweep! dir adapters)
  (assert= "sweep!: dirty-blocked surfaces only once across repeated identical ticks" 1 (:surface! @calls)))

;; should-reconcile, merge succeeds: merge! called once, no surface, state cleared
(let [dir (mk-tmp)
      {:keys [calls logs adapters]} (mk-adapters {:ahead 0 :behind 22 :clean? true :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! dir adapters)
  (assert= "sweep!: should-reconcile calls merge! exactly once" 1 (:merge! @calls))
  (assert= "sweep!: a successful reconcile never surfaces" 0 (:surface! @calls))
  (assert-true "sweep!: a successful reconcile logs 'reconciled'"
               (some #(clojure.string/includes? % "reconciled") @logs))
  (assert= "sweep!: a successful reconcile clears persisted state"
           {} (master-main-reconcile-lib/read-state dir)))

;; should-reconcile, merge fails (conflict): surfaced exactly once, state records it
(let [dir (mk-tmp)
      {:keys [calls surfaced adapters]}
      (mk-adapters {:ahead 0 :behind 22 :clean? true :merge-result {:success false :error "CONFLICT"}})]
  (master-main-reconcile-lib/sweep! dir adapters)
  (assert= "sweep!: a failed reconcile surfaces exactly once" 1 (:surface! @calls))
  (assert-true "sweep!: a failed reconcile's surfaced message names 'conflict'"
               (clojure.string/includes? (first @surfaced) "conflict")))

;; idempotent re-run (ticket's own QA procedure (c)): once reconciled,
;; a SECOND tick against the now-up-to-date counts changes nothing further
(let [dir (mk-tmp)
      first-tick (mk-adapters {:ahead 0 :behind 22 :clean? true :merge-result {:success true}})
      second-tick (mk-adapters {:ahead 0 :behind 0 :clean? true})]
  (master-main-reconcile-lib/sweep! dir (:adapters first-tick))
  (master-main-reconcile-lib/sweep! dir (:adapters second-tick))
  (assert= "sweep!: re-run after reconciling calls merge! zero more times" 0 (:merge! @(:calls second-tick)))
  (assert= "sweep!: re-run after reconciling never surfaces" 0 (:surface! @(:calls second-tick))))

;; self-healing: a DIFFERENT block reason (conflict, after a prior dirty
;; surfacing) re-surfaces fresh rather than being suppressed by the stale flag
(let [dir (mk-tmp)
      dirty-tick (mk-adapters {:ahead 0 :behind 22 :clean? false})
      conflict-tick (mk-adapters {:ahead 0 :behind 22 :clean? true :merge-result {:success false :error "x"}})]
  (master-main-reconcile-lib/sweep! dir (:adapters dirty-tick))
  (master-main-reconcile-lib/sweep! dir (:adapters conflict-tick))
  (assert= "sweep!: a new block REASON surfaces even right after a different reason was already surfaced"
           1 (:surface! @(:calls conflict-tick))))

;; ── report ───────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL TESTS PASS")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
