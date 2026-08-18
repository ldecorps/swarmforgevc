#!/usr/bin/env bb
;; TDD runner for master_main_reconcile_lib.bb (BL-891, narrowed by BL-919) -
;; no real git process, no real clock, no real network (every adapter is a
;; fake). Mirrors push_sweep_lib_test_runner.bb's own assert-battery shape.

(ns master-main-reconcile-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_main_reconcile_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── porcelain-lines->paths ──────────────────────────────────────────────

(assert= "porcelain-lines->paths: blank input -> empty set"
         #{} (master-main-reconcile-lib/porcelain-lines->paths ""))
(assert= "porcelain-lines->paths: modified tracked file"
         #{"seed.txt"} (master-main-reconcile-lib/porcelain-lines->paths " M seed.txt"))
(assert= "porcelain-lines->paths: staged (added) file"
         #{"staged.txt"} (master-main-reconcile-lib/porcelain-lines->paths "A  staged.txt"))
(assert= "porcelain-lines->paths: untracked file"
         #{"newfile.txt"} (master-main-reconcile-lib/porcelain-lines->paths "?? newfile.txt"))
(assert= "porcelain-lines->paths: rename reports BOTH the old and new path"
         #{"old.txt" "new.txt"} (master-main-reconcile-lib/porcelain-lines->paths "R  old.txt -> new.txt"))
(assert= "porcelain-lines->paths: multiple lines, one set"
         #{"a.txt" "b.txt" "c.txt"}
         (master-main-reconcile-lib/porcelain-lines->paths " M a.txt\n?? b.txt\nA  c.txt"))
(assert= "porcelain-lines->paths: trailing blank line ignored"
         #{"a.txt"} (master-main-reconcile-lib/porcelain-lines->paths " M a.txt\n"))

;; ── overlapping-paths ───────────────────────────────────────────────────

(assert= "overlapping-paths: disjoint sets -> empty"
         #{} (master-main-reconcile-lib/overlapping-paths #{"a.txt"} #{"b.txt"}))
(assert= "overlapping-paths: shared path -> that path"
         #{"a.txt"} (master-main-reconcile-lib/overlapping-paths #{"a.txt" "b.txt"} #{"a.txt" "c.txt"}))
(assert= "overlapping-paths: empty dirty-paths never overlaps anything"
         #{} (master-main-reconcile-lib/overlapping-paths #{} #{"a.txt" "b.txt"}))

;; ── reconcile-decision ──────────────────────────────────────────────────

(assert= "reconcile-decision: nothing behind -> up-to-date, regardless of dirt"
         :up-to-date (master-main-reconcile-lib/reconcile-decision
                      {:behind 0 :dirty-paths #{"a.txt"} :merge-changed-paths #{"a.txt"}}))
(assert= "reconcile-decision: nothing behind, clean -> up-to-date"
         :up-to-date (master-main-reconcile-lib/reconcile-decision {:behind 0}))
(assert= "reconcile-decision: nil counts/paths default -> up-to-date"
         :up-to-date (master-main-reconcile-lib/reconcile-decision {}))
(assert= "reconcile-decision: behind, fully clean tree -> should-reconcile"
         :should-reconcile (master-main-reconcile-lib/reconcile-decision {:behind 5}))
(assert= "reconcile-decision: BL-919 existence proof - behind, dirty tree, but the dirty path does NOT overlap the incoming merge -> should-reconcile (this is the whole point of the ticket)"
         :should-reconcile (master-main-reconcile-lib/reconcile-decision
                             {:behind 5 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"landed-1.txt"}}))
(assert= "reconcile-decision: behind, dirty path IS one the incoming merge would change -> dirty-blocked"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}}))
(assert= "reconcile-decision: untracked file clashing with a path the merge would create -> dirty-blocked"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{"clash.txt"} :merge-changed-paths #{"clash.txt" "other.txt"}}))
(assert= "reconcile-decision: multiple dirty paths, only ONE overlaps -> still dirty-blocked"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{"a.txt" "b.txt"} :merge-changed-paths #{"b.txt"}}))
(assert= "reconcile-decision: multiple dirty paths, NONE overlap -> should-reconcile"
         :should-reconcile (master-main-reconcile-lib/reconcile-decision
                             {:behind 5 :dirty-paths #{"a.txt" "b.txt"} :merge-changed-paths #{"c.txt"}}))
(assert= "reconcile-decision: uncertain dirty-check (unknown-dirty-marker present) always forces dirty-blocked, even with an empty merge-changed-paths"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{master-main-reconcile-lib/unknown-dirty-marker} :merge-changed-paths #{}}))
(assert= "reconcile-decision: uncertain merge-changed-paths computation with real dirt present forces dirty-blocked (can't rule out overlap)"
         :dirty-blocked (master-main-reconcile-lib/reconcile-decision
                          {:behind 5 :dirty-paths #{"seed.txt"} :merge-changed-paths #{master-main-reconcile-lib/unknown-dirty-marker}}))
(assert= "reconcile-decision: uncertain merge-changed-paths computation with a FULLY CLEAN tree still reconciles - nothing dirty could possibly overlap"
         :should-reconcile (master-main-reconcile-lib/reconcile-decision
                             {:behind 5 :dirty-paths #{} :merge-changed-paths #{master-main-reconcile-lib/unknown-dirty-marker}}))

;; ── drift-report ────────────────────────────────────────────────────────

(assert= "drift-report: passes both counts through"
         {:ahead 8 :behind 22} (master-main-reconcile-lib/drift-report {:ahead 8 :behind 22}))
(assert= "drift-report: nil counts default to 0"
         {:ahead 0 :behind 0} (master-main-reconcile-lib/drift-report {}))

;; ── surface-message / surface-draft-lines ──────────────────────────────

(let [msg (master-main-reconcile-lib/surface-message {:behind 22 :reason :dirty :overlapping-paths #{"seed.txt"}})]
  (assert-true "surface-message: dirty reason mentions behind count" (clojure.string/includes? msg "22"))
  (assert-true "surface-message: dirty reason names the single overlapping path" (clojure.string/includes? msg "seed.txt"))
  (assert-true "surface-message: stays within the 80-char note limit" (<= (count msg) 80)))

(let [msg (master-main-reconcile-lib/surface-message {:behind 22 :reason :dirty :overlapping-paths #{"a.txt" "b.txt" "c.txt"}})]
  (assert-true "surface-message: multiple overlapping paths collapse to a count" (clojure.string/includes? msg "3 paths"))
  (assert-true "surface-message: stays within the 80-char note limit" (<= (count msg) 80)))

(let [long-path "backlog/active/BL-919-reconcile-refuses-only-real-conflicts.yaml"
      msg (master-main-reconcile-lib/surface-message {:behind 22 :reason :dirty :overlapping-paths #{long-path}})]
  (assert-true "surface-message: a path too long to fit falls back to the unnamed form rather than exceeding the limit"
               (not (clojure.string/includes? msg long-path)))
  (assert-true "surface-message: still stays within the 80-char note limit even for a long path" (<= (count msg) 80)))

(let [msg (master-main-reconcile-lib/surface-message {:behind 22 :reason :dirty :overlapping-paths #{}})]
  (assert-true "surface-message: no named paths still mentions the behind count" (clojure.string/includes? msg "22"))
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
  [{:keys [ahead behind dirty-paths merge-changed-paths merge-result]}]
  (let [calls (atom {:rev-counts! 0 :dirty-paths! 0 :merge-changed-paths! 0 :merge! 0 :surface! 0})
        logs (atom [])
        surfaced (atom [])]
    {:calls calls
     :logs logs
     :surfaced surfaced
     :adapters
     {:rev-counts! (fn [] (swap! calls update :rev-counts! inc) {:ahead ahead :behind behind})
      :dirty-paths! (fn [] (swap! calls update :dirty-paths! inc) (or dirty-paths #{}))
      :merge-changed-paths! (fn [] (swap! calls update :merge-changed-paths! inc) (or merge-changed-paths #{}))
      :merge! (fn [] (swap! calls update :merge! inc) merge-result)
      :surface! (fn [msg] (swap! calls update :surface! inc) (swap! surfaced conj msg))
      :log! (fn [& parts] (swap! logs conj (clojure.string/join " " parts)))}}))

;; up-to-date: merge! and surface! are never called
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 0})]
  (master-main-reconcile-lib/sweep! (mk-tmp) adapters)
  (assert= "sweep!: up-to-date never calls merge!" 0 (:merge! @calls))
  (assert= "sweep!: up-to-date never calls surface!" 0 (:surface! @calls))
  (assert= "sweep!: up-to-date never bothers computing merge-changed-paths (nothing to diff against)"
           0 (:merge-changed-paths! @calls)))

;; dirty-blocked (overlap): merge! is NEVER called (invariant 1: never
;; touches a tree it's not safe to touch), surface! IS called exactly once,
;; naming the reason
(let [{:keys [calls surfaced adapters]} (mk-adapters {:ahead 3 :behind 22
                                                        :dirty-paths #{"seed.txt"}
                                                        :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) adapters)
  (assert= "sweep!: dirty-blocked (overlap) never calls merge!" 0 (:merge! @calls))
  (assert= "sweep!: dirty-blocked (overlap) surfaces exactly once" 1 (:surface! @calls))
  (assert-true "sweep!: dirty-blocked surfaced message names the behind count"
               (clojure.string/includes? (first @surfaced) "22"))
  (assert-true "sweep!: dirty-blocked surfaced message names the offending path"
               (clojure.string/includes? (first @surfaced) "seed.txt")))

;; BL-919's own existence proof, at the sweep! layer: a dirty tree whose
;; dirty path does NOT overlap what the merge would change reconciles
;; exactly like a clean tree would - merge! IS called, nothing is surfaced.
(let [{:keys [calls logs adapters]} (mk-adapters {:ahead 0 :behind 22
                                                    :dirty-paths #{"seed.txt"}
                                                    :merge-changed-paths #{"landed-1.txt"}
                                                    :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) adapters)
  (assert= "sweep!: non-overlapping dirt calls merge! exactly once (BL-919's own point)" 1 (:merge! @calls))
  (assert= "sweep!: non-overlapping dirt never surfaces" 0 (:surface! @calls))
  (assert-true "sweep!: non-overlapping dirt logs 'reconciled'"
               (some #(clojure.string/includes? % "reconciled") @logs)))

;; dirty-blocked repeated: a SECOND tick with the SAME overlap does not
;; re-surface (avoid spamming the coordinator every poll cycle)
(let [dir (mk-tmp)
      {:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 22
                                              :dirty-paths #{"seed.txt"}
                                              :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! dir adapters)
  (master-main-reconcile-lib/sweep! dir adapters)
  (assert= "sweep!: dirty-blocked surfaces only once across repeated identical ticks" 1 (:surface! @calls)))

;; should-reconcile, merge succeeds: merge! called once, no surface, state cleared
(let [dir (mk-tmp)
      {:keys [calls logs adapters]} (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})]
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
      (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "CONFLICT"}})]
  (master-main-reconcile-lib/sweep! dir adapters)
  (assert= "sweep!: a failed reconcile surfaces exactly once" 1 (:surface! @calls))
  (assert-true "sweep!: a failed reconcile's surfaced message names 'conflict'"
               (clojure.string/includes? (first @surfaced) "conflict")))

;; idempotent re-run (ticket's own QA procedure (c)): once reconciled,
;; a SECOND tick against the now-up-to-date counts changes nothing further
(let [dir (mk-tmp)
      first-tick (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})
      second-tick (mk-adapters {:ahead 0 :behind 0})]
  (master-main-reconcile-lib/sweep! dir (:adapters first-tick))
  (master-main-reconcile-lib/sweep! dir (:adapters second-tick))
  (assert= "sweep!: re-run after reconciling calls merge! zero more times" 0 (:merge! @(:calls second-tick)))
  (assert= "sweep!: re-run after reconciling never surfaces" 0 (:surface! @(:calls second-tick))))

;; self-healing: a DIFFERENT block reason (conflict, after a prior dirty
;; surfacing) re-surfaces fresh rather than being suppressed by the stale flag
(let [dir (mk-tmp)
      dirty-tick (mk-adapters {:ahead 0 :behind 22
                                :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      conflict-tick (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "x"}})]
  (master-main-reconcile-lib/sweep! dir (:adapters dirty-tick))
  (master-main-reconcile-lib/sweep! dir (:adapters conflict-tick))
  (assert= "sweep!: a new block REASON surfaces even right after a different reason was already surfaced"
           1 (:surface! @(:calls conflict-tick))))

;; uncertain dirty-check (real git status failure): the sentinel forces a
;; block even though nothing was actually diffed against
(let [{:keys [calls surfaced adapters]}
      (mk-adapters {:ahead 0 :behind 22 :dirty-paths #{master-main-reconcile-lib/unknown-dirty-marker}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) adapters)
  (assert= "sweep!: an uncertain dirty-check never calls merge!" 0 (:merge! @calls))
  (assert= "sweep!: an uncertain dirty-check surfaces exactly once" 1 (:surface! @calls)))

;; ── report ───────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL TESTS PASS")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
