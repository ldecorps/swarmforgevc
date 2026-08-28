#!/usr/bin/env bb
;; TDD runner for master_main_reconcile_lib.bb (BL-891, narrowed by BL-919) -
;; no real git process, no real clock, no real network (every adapter is a
;; fake). Mirrors push_sweep_lib_test_runner.bb's own assert-battery shape.

(ns master-main-reconcile-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

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
  (assert-true "surface-message: conflict reason names rematch/refuse"
               (master-main-reconcile-lib/absorb-outcome-names-rematch-or-refuse? msg))
  (assert-true "surface-message: stays within the 80-char note limit" (<= (count msg) 80)))

(let [msg (master-main-reconcile-lib/surface-message {:behind 5 :reason :refuse-rematch})]
  (assert-true "surface-message: refuse-rematch names rematch"
               (clojure.string/includes? msg "rematch"))
  (assert-true "surface-message: refuse-rematch stays within 80 chars" (<= (count msg) 80)))

(assert= "automated-absorb-plan: conflict foresight refuses"
         :refuse-rematch
         (master-main-reconcile-lib/automated-absorb-plan
          {:merge-head-present? false :behind 2 :would-conflict? true :tip-contains-origin? false}))
(assert= "automated-absorb-plan: tip contains origin -> noop"
         :noop
         (master-main-reconcile-lib/automated-absorb-plan
          {:merge-head-present? false :behind 0 :would-conflict? false :tip-contains-origin? true}))
(assert= "automated-absorb-plan: clean behind -> run-merge"
         :run-merge
         (master-main-reconcile-lib/automated-absorb-plan
          {:merge-head-present? false :behind 2 :would-conflict? false :tip-contains-origin? false}))
(assert-true "post-absorb-clean: no MERGE_HEAD and no unmerged"
             (master-main-reconcile-lib/post-absorb-clean? false 0))
(assert-true "post-absorb-clean: MERGE_HEAD is dirty"
             (not (master-main-reconcile-lib/post-absorb-clean? true 0)))


;; BL-1144 publish-time rematch + land/close serialize
(assert-true "gate vs publish SHA drift detected"
             (master-main-reconcile-lib/origin-advanced-since-gate? "aaa" "bbb"))
(assert-true "same SHA is not advanced"
             (not (master-main-reconcile-lib/origin-advanced-since-gate? "aaa" "aaa")))
(assert= "publish-time: tip already pure -> push"
         :push
         (master-main-reconcile-lib/publish-time-purity-action
          {:tip-contains-origin-now? true :rematch-would-conflict? false
           :attempt 0 :peer-holds-land-lock? false}))
(assert= "publish-time: stale tip rematches before push"
         :rematch-then-push
         (master-main-reconcile-lib/publish-time-purity-action
          {:tip-contains-origin-now? false :rematch-would-conflict? false
           :attempt 0 :peer-holds-land-lock? false}))
(assert= "publish-time: residual race retries once"
         :retry-rematch
         (master-main-reconcile-lib/publish-time-purity-action
          {:tip-contains-origin-now? false :rematch-would-conflict? false
           :attempt 1 :peer-holds-land-lock? false}))
(assert= "publish-time: attempts exhausted -> wait lock (bounded)"
         :wait-land-lock
         (master-main-reconcile-lib/publish-time-purity-action
          {:tip-contains-origin-now? false :rematch-would-conflict? false
           :attempt 2 :peer-holds-land-lock? false}))
(assert= "publish-time: peer lock waits rather than bounce"
         :wait-land-lock
         (master-main-reconcile-lib/publish-time-purity-action
          {:tip-contains-origin-now? false :rematch-would-conflict? false
           :attempt 0 :peer-holds-land-lock? true}))
(assert= "publish-time: conflict refuses rematch lander"
         :refuse-rematch-lander
         (master-main-reconcile-lib/publish-time-purity-action
          {:tip-contains-origin-now? false :rematch-would-conflict? true
           :attempt 0 :peer-holds-land-lock? false}))
(assert= "lock edge: free lock admits"
         :admit
         (master-main-reconcile-lib/land-close-publisher-admission
          {:lock-available? true :already-rematched-at-edge? false}))
(assert= "lock edge: second publisher rematches once"
         :rematch-once-at-edge
         (master-main-reconcile-lib/land-close-publisher-admission
          {:lock-available? false :already-rematched-at-edge? false}))
(assert= "lock edge: after one rematch, wait"
         :wait-lock
         (master-main-reconcile-lib/land-close-publisher-admission
          {:lock-available? false :already-rematched-at-edge? true}))
(assert= "contention: wait-lock wins over rematch-then-push"
         :wait-land-lock
         (master-main-reconcile-lib/contention-publish-next
          {:purity-action :rematch-then-push :lock-admission :wait-lock}))
(assert-true "residual recovery rematch lander ok"
             (master-main-reconcile-lib/residual-race-recovery-ok? :rematch-lander))
(assert-true "operator absorb not ok residual"
             (not (master-main-reconcile-lib/residual-race-recovery-ok? :operator-absorb)))
(assert-true "tip purity always required"
             (master-main-reconcile-lib/tip-purity-required?))

;; BL-1131 rematch-then-FF
(assert= "prepublish: tip already contains origin"
         :already-contains-origin
         (master-main-reconcile-lib/prepublish-rematch-plan
          {:tip-contains-origin? true :rematch-would-conflict? false}))
(assert= "prepublish: clean rematch"
         :rematch-clean
         (master-main-reconcile-lib/prepublish-rematch-plan
          {:tip-contains-origin? false :rematch-would-conflict? false}))
(assert= "prepublish: conflicting rematch refuses lander"
         :refuse-lander
         (master-main-reconcile-lib/prepublish-rematch-plan
          {:tip-contains-origin? false :rematch-would-conflict? true}))
(assert-true "may-publish after rematch-clean"
             (master-main-reconcile-lib/may-publish-land-tip? :rematch-clean))
(assert-true "may-not-publish on refuse-lander"
             (not (master-main-reconcile-lib/may-publish-land-tip? :refuse-lander)))
(assert= "post-land: behind-only is ff-absorb"
         :ff-absorb
         (master-main-reconcile-lib/post-land-absorb-plan
          {:behind 2 :ahead 0 :tip-contains-origin? false :absorb-would-conflict? false}))
(assert= "post-land: colliding ahead is replay-bookkeeping"
         :replay-bookkeeping
         (master-main-reconcile-lib/post-land-absorb-plan
          {:behind 2 :ahead 1 :tip-contains-origin? false :absorb-would-conflict? true}))
(let [ok (master-main-reconcile-lib/land-pipeline-outcome
          {:prepublish-plan :rematch-clean :absorb-plan :ff-absorb :mid-merge? false})]
  (assert= "land success behind 0" 0 (:behind ok))
  (assert= "land success proceed" :proceed (:sync-action ok))
  (assert-true "land success ok" (:ok? ok))
  (assert-true "land success not operator absorb"
               (not (:designed-recovery-operator-absorb? ok))))
(let [race (master-main-reconcile-lib/land-pipeline-outcome
            {:prepublish-plan :already-contains-origin
             :absorb-plan :replay-bookkeeping :mid-merge? false})]
  (assert= "race recovery bookkeeping" :rematch-bookkeeping-owner (:recovery race))
  (assert-true "race not operator absorb"
               (not (:designed-recovery-operator-absorb? race)))
  (assert-true "race not mid-merge" (not (:mid-merge? race))))
(assert-true "operator absorb phrase detected"
             (master-main-reconcile-lib/designed-recovery-is-operator-absorb?
              "Complete origin/main merge: resolve UU"))
(assert-true "rematch lander is not operator absorb"
             (not (master-main-reconcile-lib/designed-recovery-is-operator-absorb?
                   :rematch-lander)))

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
  (let [calls (atom {:rev-counts! 0 :dirty-paths! 0 :merge-changed-paths! 0 :merge! 0 :surface! 0 :escalate! 0})
        logs (atom [])
        surfaced (atom [])
        escalated (atom [])]
    {:calls calls
     :logs logs
     :surfaced surfaced
     :escalated escalated
     :adapters
     {:rev-counts! (fn [] (swap! calls update :rev-counts! inc) {:ahead ahead :behind behind})
      :dirty-paths! (fn [] (swap! calls update :dirty-paths! inc) (or dirty-paths #{}))
      :merge-changed-paths! (fn [] (swap! calls update :merge-changed-paths! inc) (or merge-changed-paths #{}))
      :merge! (fn [] (swap! calls update :merge! inc) merge-result)
      :surface! (fn [msg] (swap! calls update :surface! inc) (swap! surfaced conj msg))
      :escalate! (fn [payload] (swap! calls update :escalate! inc) (swap! escalated conj payload))
      :log! (fn [& parts] (swap! logs conj (clojure.string/join " " parts)))}}))

;; Default escalation threshold used by every sweep! call below unless a
;; test names its own - high enough (well above BL-920's own documented
;; default of 3) that no PRE-EXISTING test above accidentally starts
;; escalating just because it happens to call sweep! more than once against
;; the same state dir.
(def default-threshold 100)

;; up-to-date: merge! and surface! are never called
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 0})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold adapters)
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
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold adapters)
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
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold adapters)
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
  (master-main-reconcile-lib/sweep! dir default-threshold adapters)
  (master-main-reconcile-lib/sweep! dir default-threshold adapters)
  (assert= "sweep!: dirty-blocked surfaces only once across repeated identical ticks" 1 (:surface! @calls)))

;; should-reconcile, merge succeeds: merge! called once, no surface, state cleared
(let [dir (mk-tmp)
      {:keys [calls logs adapters]} (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! dir default-threshold adapters)
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
  (master-main-reconcile-lib/sweep! dir default-threshold adapters)
  (assert= "sweep!: a failed reconcile surfaces exactly once" 1 (:surface! @calls))
  (assert-true "sweep!: a failed reconcile's surfaced message names rematch/refuse"
               (master-main-reconcile-lib/absorb-outcome-names-rematch-or-refuse?
                (first @surfaced))))

;; idempotent re-run (ticket's own QA procedure (c)): once reconciled,
;; a SECOND tick against the now-up-to-date counts changes nothing further
(let [dir (mk-tmp)
      first-tick (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})
      second-tick (mk-adapters {:ahead 0 :behind 0})]
  (master-main-reconcile-lib/sweep! dir default-threshold (:adapters first-tick))
  (master-main-reconcile-lib/sweep! dir default-threshold (:adapters second-tick))
  (assert= "sweep!: re-run after reconciling calls merge! zero more times" 0 (:merge! @(:calls second-tick)))
  (assert= "sweep!: re-run after reconciling never surfaces" 0 (:surface! @(:calls second-tick))))

;; self-healing: a DIFFERENT block reason (conflict, after a prior dirty
;; surfacing) re-surfaces fresh rather than being suppressed by the stale flag
(let [dir (mk-tmp)
      dirty-tick (mk-adapters {:ahead 0 :behind 22
                                :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      conflict-tick (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "x"}})]
  (master-main-reconcile-lib/sweep! dir default-threshold (:adapters dirty-tick))
  (master-main-reconcile-lib/sweep! dir default-threshold (:adapters conflict-tick))
  (assert= "sweep!: a new block REASON surfaces even right after a different reason was already surfaced"
           1 (:surface! @(:calls conflict-tick))))

;; uncertain dirty-check (real git status failure): the sentinel forces a
;; block even though nothing was actually diffed against
(let [{:keys [calls surfaced adapters]}
      (mk-adapters {:ahead 0 :behind 22 :dirty-paths #{master-main-reconcile-lib/unknown-dirty-marker}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold adapters)
  (assert= "sweep!: an uncertain dirty-check never calls merge!" 0 (:merge! @calls))
  (assert= "sweep!: an uncertain dirty-check surfaces exactly once" 1 (:surface! @calls)))

;; ── BL-920: parse-escalation-threshold ─────────────────────────────────

(assert= "parse-escalation-threshold: absent config -> default"
         3 (master-main-reconcile-lib/parse-escalation-threshold ""))
(assert= "parse-escalation-threshold: honors a configured positive integer"
         7 (master-main-reconcile-lib/parse-escalation-threshold "config master_main_reconcile_escalation_threshold 7"))
(assert= "parse-escalation-threshold: zero degrades to default"
         3 (master-main-reconcile-lib/parse-escalation-threshold "config master_main_reconcile_escalation_threshold 0"))
(assert= "parse-escalation-threshold: negative degrades to default"
         3 (master-main-reconcile-lib/parse-escalation-threshold "config master_main_reconcile_escalation_threshold -2"))
(assert= "parse-escalation-threshold: malformed value degrades to default"
         3 (master-main-reconcile-lib/parse-escalation-threshold "config master_main_reconcile_escalation_threshold not-a-number"))
(assert= "parse-escalation-threshold: an unrelated config line is ignored"
         3 (master-main-reconcile-lib/parse-escalation-threshold "config active_backlog_max_depth 9"))

;; ── BL-920: next-block-state / escalation-due? (pure) ──────────────────

(assert= "next-block-state: no prior state -> fresh episode, ticks 1, not escalated"
         {:surfaced "dirty" :ticks 1 :escalated false}
         (master-main-reconcile-lib/next-block-state {} "dirty"))
(assert= "next-block-state: same reason as previous tick -> ticks increments, escalated carried"
         {:surfaced "dirty" :ticks 2 :escalated false}
         (master-main-reconcile-lib/next-block-state {:surfaced "dirty" :ticks 1 :escalated false} "dirty"))
(assert= "next-block-state: an already-escalated episode continuing the SAME reason keeps :escalated true"
         {:surfaced "dirty" :ticks 4 :escalated true}
         (master-main-reconcile-lib/next-block-state {:surfaced "dirty" :ticks 3 :escalated true} "dirty"))
(assert= "next-block-state: a DIFFERENT reason resets to a fresh episode, even if the prior one had escalated"
         {:surfaced "conflict" :ticks 1 :escalated false}
         (master-main-reconcile-lib/next-block-state {:surfaced "dirty" :ticks 5 :escalated true} "conflict"))

(assert-true "escalation-due?: below threshold -> not due"
             (not (master-main-reconcile-lib/escalation-due? {:ticks 2 :escalated false} 3)))
(assert-true "escalation-due?: exactly at threshold, not yet escalated -> due"
             (master-main-reconcile-lib/escalation-due? {:ticks 3 :escalated false} 3))
(assert-true "escalation-due?: past threshold, not yet escalated -> still due"
             (master-main-reconcile-lib/escalation-due? {:ticks 5 :escalated false} 3))
(assert-true "escalation-due?: at threshold but already escalated -> not due again"
             (not (master-main-reconcile-lib/escalation-due? {:ticks 3 :escalated true} 3)))

;; ── BL-920: escalation-reason / escalation-telegram-text / escalation-email-subject ──

(let [text (master-main-reconcile-lib/escalation-reason "dirty" 22 3)]
  (assert-true "escalation-reason: names the reason" (clojure.string/includes? text "dirty"))
  (assert-true "escalation-reason: names the behind count" (clojure.string/includes? text "22"))
  (assert-true "escalation-reason: names the tick count" (clojure.string/includes? text "3")))

(let [text (master-main-reconcile-lib/escalation-telegram-text "conflict" 9 5)]
  (assert-true "escalation-telegram-text: names the reason" (clojure.string/includes? text "conflict"))
  (assert-true "escalation-telegram-text: names the behind count" (clojure.string/includes? text "9"))
  (assert-true "escalation-telegram-text: names the tick count" (clojure.string/includes? text "5")))

(assert-true "escalation-email-subject: names the reason"
             (clojure.string/includes? (master-main-reconcile-lib/escalation-email-subject "dirty") "dirty"))

;; ── BL-920: sweep! integration - escalation is additive to, and separate
;;    from, the coordinator note (invariant 1) ──────────────────────────

;; First tick of a block: the coordinator note fires exactly as before;
;; escalate! does NOT fire (ticks=1 is below any sane threshold >1).
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 22
                                              :dirty-paths #{"seed.txt"}
                                              :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) 2 adapters)
  (assert= "sweep!: first tick of a block surfaces the coordinator note" 1 (:surface! @calls))
  (assert= "sweep!: first tick of a block never escalates" 0 (:escalate! @calls)))

;; threshold=1 is a real, reachable config value (parse-escalation-threshold
;; only rejects absent/zero/negative/malformed, never 1) and collapses the
;; first tick and the escalation onto the SAME tick: escalation-due? reads
;; (>= ticks 1), and the first tick's next-block-state already carries
;; :ticks 1. Both signals still fire - additive, never instead-of (invariant
;; 1 holds even at this boundary) - but nothing exercised this before, and
;; it is exactly the boundary condition most likely for an off-by-one to
;; silently invert (e.g. a caller mistaking "escalated on tick 1" for "the
;; threshold was never actually 1").
(let [{:keys [calls escalated adapters]} (mk-adapters {:ahead 0 :behind 22
                                                         :dirty-paths #{"seed.txt"}
                                                         :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) 1 adapters)
  (assert= "sweep!: threshold=1 still surfaces the coordinator note on tick 1" 1 (:surface! @calls))
  (assert= "sweep!: threshold=1 also escalates on that same tick 1" 1 (:escalate! @calls))
  (assert= "sweep!: threshold=1 escalation payload's tick count is 1" 1 (:ticks (first @escalated))))

;; A state file written by pre-BL-920 code (or a mid-upgrade daemon restart)
;; has no :ticks/:escalated keys at all - only {:surfaced "dirty"}. This is
;; a real on-disk shape, not a hypothetical: it is exactly what write-state!
;; wrote before this ticket. next-block-state must treat the missing keys as
;; "no ticks yet" / "not escalated" (fnil/not-nil degrade), never crash, and
;; never silently skip the coordinator's already-fired note into a second
;; first-tick surface.
(let [dir (mk-tmp)]
  (master-main-reconcile-lib/write-state! dir {:surfaced "dirty"})
  (let [{:keys [calls escalated adapters]} (mk-adapters {:ahead 0 :behind 22
                                                           :dirty-paths #{"seed.txt"}
                                                           :merge-changed-paths #{"seed.txt"}})]
    (master-main-reconcile-lib/sweep! dir 1 adapters)
    (assert= "sweep!: an old-format state file (no :ticks/:escalated) for the SAME reason never re-surfaces"
             0 (:surface! @calls))
    (assert= "sweep!: an old-format state file's missing :ticks starts counting from this tick, not crashing"
             1 (:escalate! @calls))
    (assert= "sweep!: an old-format state file's first counted tick reports ticks=1"
             1 (:ticks (first @escalated)))))

;; The SAME reason persisting past threshold=2 escalates on the SECOND
;; consecutive tick - additive to (not instead of) the first tick's note.
(let [dir (mk-tmp)
      first-tick (mk-adapters {:ahead 0 :behind 22
                                :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      second-tick (mk-adapters {:ahead 0 :behind 22
                                 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! dir 2 (:adapters first-tick))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters second-tick))
  (assert= "sweep!: second consecutive tick still does not re-surface the note"
           0 (:surface! @(:calls second-tick)))
  (assert= "sweep!: second consecutive tick (== threshold) escalates exactly once"
           1 (:escalate! @(:calls second-tick)))
  (let [payload (first @(:escalated second-tick))]
    (assert= "sweep!: escalation payload names the reason" "dirty" (:reason payload))
    (assert= "sweep!: escalation payload names the behind count" 22 (:behind payload))
    (assert= "sweep!: escalation payload names the tick count" 2 (:ticks payload))))

;; A THIRD consecutive tick of the same episode does not escalate again -
;; once per episode, not per tick (qa_e2e_procedure step 3).
(let [dir (mk-tmp)
      ticks (mapv (fn [_] (mk-adapters {:ahead 0 :behind 22
                                         :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}}))
                  (range 3))]
  (doseq [t ticks] (master-main-reconcile-lib/sweep! dir 2 (:adapters t)))
  (assert= "sweep!: a third consecutive tick past threshold does not re-escalate"
           0 (:escalate! @(:calls (nth ticks 2)))))

;; Resolving clears escalation state: after escalating, a successful
;; reconcile, then a NEW block of the SAME reason escalates again on its
;; own fresh schedule rather than being suppressed forever (invariant 2).
(let [dir (mk-tmp)
      tick1 (mk-adapters {:ahead 0 :behind 22
                           :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      tick2 (mk-adapters {:ahead 0 :behind 22
                           :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      resolve-tick (mk-adapters {:ahead 0 :behind 0})
      new-episode-tick1 (mk-adapters {:ahead 0 :behind 22
                                       :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      new-episode-tick2 (mk-adapters {:ahead 0 :behind 22
                                       :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! dir 2 (:adapters tick1))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters tick2))
  (assert= "sweep!: escalates once by the second tick of episode 1" 1 (:escalate! @(:calls tick2)))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters resolve-tick))
  (assert= "sweep!: resolving clears persisted state entirely" {} (master-main-reconcile-lib/read-state dir))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters new-episode-tick1))
  (assert= "sweep!: a fresh episode's first tick does not immediately escalate"
           0 (:escalate! @(:calls new-episode-tick1)))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters new-episode-tick2))
  (assert= "sweep!: a fresh episode escalates again on its OWN schedule, not suppressed by the resolved episode"
           1 (:escalate! @(:calls new-episode-tick2))))

;; A DIFFERENT block reason right after an escalated episode also starts
;; fresh (no immediate escalate) - judged on its own merits (invariant 2),
;; extended from surfaced-reason-changed to escalation state too.
(let [dir (mk-tmp)
      dirty-tick1 (mk-adapters {:ahead 0 :behind 22
                                 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      dirty-tick2 (mk-adapters {:ahead 0 :behind 22
                                 :dirty-paths #{"seed.txt"} :merge-changed-paths #{"seed.txt"}})
      conflict-tick1 (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "x"}})]
  (master-main-reconcile-lib/sweep! dir 2 (:adapters dirty-tick1))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters dirty-tick2))
  (assert= "sweep!: dirty episode escalates by its second tick" 1 (:escalate! @(:calls dirty-tick2)))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters conflict-tick1))
  (assert= "sweep!: a new, unrelated block reason surfaces its own first-tick note"
           1 (:surface! @(:calls conflict-tick1)))
  (assert= "sweep!: a new, unrelated block reason does not inherit the prior episode's escalation"
           0 (:escalate! @(:calls conflict-tick1))))

;; The conflict reason escalates through the identical threshold machinery
;; (qa_e2e_procedure step 6 - "the human named both").
(let [dir (mk-tmp)
      tick1 (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "x"}})
      tick2 (mk-adapters {:ahead 0 :behind 22 :merge-result {:success false :error "x"}})]
  (master-main-reconcile-lib/sweep! dir 2 (:adapters tick1))
  (assert= "sweep!: conflict first tick surfaces, does not escalate" 0 (:escalate! @(:calls tick1)))
  (master-main-reconcile-lib/sweep! dir 2 (:adapters tick2))
  (assert= "sweep!: conflict second consecutive tick escalates exactly once" 1 (:escalate! @(:calls tick2)))
  (assert= "sweep!: conflict escalation payload names the conflict reason"
           "conflict" (:reason (first @(:escalated tick2)))))

;; A sweep that is never blocked never escalates.
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 0})]
  (master-main-reconcile-lib/sweep! (mk-tmp) 2 adapters)
  (assert= "sweep!: an up-to-date tick never escalates (sanity, matches the never-blocked never-escalates contract)"
           0 (:escalate! @calls)))

;; ── sync-action / deadlock (coordinator step 0 + circuit breaker) ────────
(assert= "sync-action: behind 0 -> proceed"
         :proceed (master-main-reconcile-lib/sync-action {:ahead 9 :behind 0}))
(assert= "sync-action: pure lag -> ff-only"
         :ff-only (master-main-reconcile-lib/sync-action {:ahead 0 :behind 30}))
(assert= "sync-action: diverged -> wait-reconcile"
         :wait-reconcile (master-main-reconcile-lib/sync-action {:ahead 9 :behind 30}))
(assert= "sync-action: dirty escalated -> wait-dirty-clear"
         :wait-dirty-clear (master-main-reconcile-lib/sync-action
                            {:ahead 9 :behind 30 :reconcile-surfaced "dirty" :reconcile-escalated true}))
(assert= "sync-action: deadlock active wins"
         :deadlock-tripped (master-main-reconcile-lib/sync-action
                            {:ahead 0 :behind 0 :deadlock-active? true}))
(assert-true "deadlock-trip-due?: trips when shape + aged + threshold"
             (master-main-reconcile-lib/deadlock-trip-due?
              {:ahead 9 :behind 30 :reconcile-escalated true
               :coordinator-in-process-aged? true :blocked-ticks 3
               :deadlock-state {} :threshold-ticks 3}))
(assert-true "deadlock-clear?: behind 0 clears"
             (master-main-reconcile-lib/deadlock-clear? 0))

(assert-true "operator-deadlock-hint names a single overlapping path"
             (clojure.string/includes?
              (master-main-reconcile-lib/operator-deadlock-hint
               {:ahead 144 :behind 593 :reason "dirty"
                :overlapping-paths ["backlog/active/BL-709.yaml"]})
              "clear overlapping path backlog/active/BL-709.yaml"))

;; ── BL-1120: never abort a foreign merge ────────────────────────────────
(assert= "merge-attempt-plan: MERGE_HEAD already present -> skip"
         :skip-human-merge-in-progress
         (master-main-reconcile-lib/merge-attempt-plan true))
(assert= "merge-attempt-plan: clean checkout -> run-merge"
         :run-merge
         (master-main-reconcile-lib/merge-attempt-plan false))
(assert-true "may-abort-failed-merge?: only when this tick started it"
             (master-main-reconcile-lib/may-abort-failed-merge? true))
(assert= "may-abort-failed-merge?: foreign MERGE_HEAD must not abort"
         false
         (master-main-reconcile-lib/may-abort-failed-merge? false))
(assert-true "surface-message names human-merge-in-progress"
             (clojure.string/includes?
              (master-main-reconcile-lib/surface-message {:behind 3 :reason :human-merge-in-progress})
              "human-merge-in-progress"))

;; ── BL-1135: rematch-bookkeeping must not page Operator absorb ───────────
(assert= "bl1135: merge-failure-reason keeps rematch-bookkeeping distinct"
         "rematch-bookkeeping"
         (master-main-reconcile-lib/merge-failure-reason :rematch-bookkeeping))
(assert= "bl1135: merge-failure-reason keeps refuse-rematch distinct"
         "refuse-rematch"
         (master-main-reconcile-lib/merge-failure-reason :refuse-rematch))
(assert= "bl1135: unknown merge outcome still maps to conflict"
         "conflict"
         (master-main-reconcile-lib/merge-failure-reason :weird))
(assert-true "bl1135: rematch-bookkeeping is rematch-owner recovery"
             (master-main-reconcile-lib/rematch-owner-recovery? "rematch-bookkeeping"))
(assert-true "bl1135: refuse-rematch is rematch-owner recovery"
             (master-main-reconcile-lib/rematch-owner-recovery? :refuse-rematch))
(assert-true "bl1135: conflict is not rematch-owner recovery"
             (not (master-main-reconcile-lib/rematch-owner-recovery? "conflict")))

(let [msg (master-main-reconcile-lib/surface-message {:behind 4 :reason :rematch-bookkeeping})]
  (assert-true "bl1135: surface-message rematch-bookkeeping cites BL-1135"
               (clojure.string/includes? msg "BL-1135"))
  (assert-true "bl1135: surface-message rematch-bookkeeping names rematch"
               (clojure.string/includes? msg "rematch"))
  (assert-true "bl1135: surface-message rematch-bookkeeping stays within 80 chars"
               (<= (count msg) 80))
  (assert-true "bl1135: surface-message rematch-bookkeeping never says needs a human"
               (not (re-find #"(?i)needs a human" msg))))

(let [tg (master-main-reconcile-lib/escalation-telegram-text "rematch-bookkeeping" 2 3)]
  (assert-true "bl1135: rematch telegram names rematch-bookkeeping"
               (clojure.string/includes? tg "rematch-bookkeeping"))
  (assert-true "bl1135: rematch telegram never says needs a human"
               (not (re-find #"(?i)needs a human" tg)))
  (assert-true "bl1135: rematch telegram never says complete origin/main merge"
               (not (re-find #"(?i)complete origin/main merge" tg))))

(let [tg (master-main-reconcile-lib/escalation-telegram-text "conflict" 2 3)]
  (assert-true "bl1135: conflict telegram still pages a human"
               (re-find #"(?i)needs a human" tg)))

;; Live sweep: rematch-bookkeeping surfaces once and never escalate!s.
(let [daemon (mk-tmp)
      {:keys [calls surfaced adapters]}
      (mk-adapters {:ahead 1 :behind 2
                    :merge-result {:success false
                                   :outcome :rematch-bookkeeping
                                   :error "rematch-bookkeeping"}})]
  (dotimes [_ 4]
    (master-main-reconcile-lib/sweep! daemon 3 adapters))
  (assert= "bl1135: rematch-bookkeeping surfaces exactly once across ticks"
           1 (:surface! @calls))
  (assert= "bl1135: rematch-bookkeeping never escalate!s (not Operator absorb)"
           0 (:escalate! @calls))
  (assert-true "bl1135: surfaced text is rematch recovery, not needs-a-human"
               (and (seq @surfaced)
                    (not (re-find #"(?i)needs a human|complete origin/main merge"
                                  (str (first @surfaced)))))))


;; ── BL-1138: rematch-bookkeeping recovers; never durable deadlock-tripped ─
(assert-true "bl1138: rematch-bookkeeping does not trip deadlock"
             (not (master-main-reconcile-lib/deadlock-trip-due?
                   {:ahead 249 :behind 38
                    :reconcile-surfaced "rematch-bookkeeping"
                    :reconcile-escalated false
                    :coordinator-in-process-aged? true
                    :blocked-ticks 99
                    :deadlock-state {}
                    :threshold-ticks 3})))
(assert-true "bl1138: refuse-rematch does not trip deadlock"
             (not (master-main-reconcile-lib/deadlock-trip-due?
                   {:ahead 2 :behind 3
                    :reconcile-surfaced "refuse-rematch"
                    :coordinator-in-process-aged? true
                    :blocked-ticks 99
                    :deadlock-state {}
                    :threshold-ticks 3})))
(assert-true "bl1138: dirty still can trip deadlock"
             (master-main-reconcile-lib/deadlock-trip-due?
              {:ahead 1 :behind 2
               :reconcile-surfaced "dirty"
               :reconcile-escalated true
               :coordinator-in-process-aged? true
               :blocked-ticks 99
               :deadlock-state {}
               :threshold-ticks 3}))

(let [land (master-main-reconcile-lib/land-pipeline-outcome
            {:prepublish-plan :rematch-clean
             :absorb-plan :ff-absorb
             :mid-merge? false})
      after (master-main-reconcile-lib/after-successful-rematch-status
             {:ahead 0 :behind 0 :deadlock-was-active? true})]
  (assert= "bl1138: rematch success behind 0" 0 (:behind after))
  (assert= "bl1138: rematch success sync proceed" :proceed (:sync-action after))
  (assert-true "bl1138: rematch success clears deadlock flag" (:clear-deadlock? after))
  (assert-true "bl1138: rematch success not deadlock-tripped"
               (not= :deadlock-tripped (:sync-action after))))

(assert-true "bl1138: rematch-bookkeeping not designed end-state deadlock"
             (not (master-main-reconcile-lib/designed-end-state-is-deadlock-tripped?
                   "rematch-bookkeeping")))
(assert-true "bl1138: conflict may still design-trip (non-rematch)"
             (master-main-reconcile-lib/designed-end-state-is-deadlock-tripped?
              "conflict"))

;; ── rematch-with-push-first! (BL-1198) ───────────────────────────────────

(let [reset-calls (atom 0)
      result (master-main-reconcile-lib/rematch-with-push-first!
              {:push! (fn [] {:success true})
               :reset! (fn [] (swap! reset-calls inc) {:success true :outcome :should-not-happen})})]
  (assert-true "bl1198: a successful push reports success" (:success result))
  (assert= "bl1198: a successful push reports outcome :pushed" :pushed (:outcome result))
  (assert= "bl1198: a successful push never calls reset!" 0 @reset-calls))

(let [push-calls (atom 0)
      result (master-main-reconcile-lib/rematch-with-push-first!
              {:push! (fn [] (swap! push-calls inc) {:success false :error "non-fast-forward"})
               :reset! (fn [] {:success true :outcome :rematched-bookkeeping})})]
  (assert= "bl1198: a rejected push still calls reset! (exactly once)" 1 @push-calls)
  (assert-true "bl1198: a rejected push falls through to reset!'s success" (:success result))
  (assert= "bl1198: a rejected push falls through to reset!'s own outcome"
           :rematched-bookkeeping (:outcome result)))

(let [result (master-main-reconcile-lib/rematch-with-push-first!
              {:push! (fn [] {:success false :error "non-fast-forward"})
               :reset! (fn [] {:success false :error "reset failed" :outcome :rematch-bookkeeping})})]
  (assert= "bl1198: reset!'s own failure result passes through verbatim"
           {:success false :error "reset failed" :outcome :rematch-bookkeeping} result))

;; ── absorb-with-merge! (BL-1214) ──────────────────────────────────────────

(let [merge-calls (atom 0)
      abort-calls (atom 0)
      fallback-calls (atom 0)
      result (master-main-reconcile-lib/absorb-with-merge!
              {:ff! (fn [] {:success true})
               :merge! (fn [] (swap! merge-calls inc) {:success true})
               :abort! (fn [] (swap! abort-calls inc))
               :fallback! (fn [] (swap! fallback-calls inc) {:success false :outcome :should-not-happen})})]
  (assert-true "bl1214: a successful fast-forward reports success" (:success result))
  (assert= "bl1214: a successful fast-forward reports outcome :ff" :ff (:outcome result))
  (assert= "bl1214: a successful fast-forward never calls merge!" 0 @merge-calls)
  (assert= "bl1214: a successful fast-forward never calls abort!" 0 @abort-calls)
  (assert= "bl1214: a successful fast-forward never calls fallback!" 0 @fallback-calls))

(let [ff-calls (atom 0)
      abort-calls (atom 0)
      fallback-calls (atom 0)
      result (master-main-reconcile-lib/absorb-with-merge!
              {:ff! (fn [] (swap! ff-calls inc) {:success false})
               :merge! (fn [] {:success true})
               :abort! (fn [] (swap! abort-calls inc))
               :fallback! (fn [] (swap! fallback-calls inc) {:success false :outcome :should-not-happen})})]
  (assert= "bl1214: a rejected fast-forward still attempts ff! exactly once" 1 @ff-calls)
  (assert-true "bl1214: a non-conflicting 3-way merge reports success" (:success result))
  (assert= "bl1214: a non-conflicting 3-way merge reports outcome :merged" :merged (:outcome result))
  (assert= "bl1214: a successful 3-way merge never calls abort!" 0 @abort-calls)
  (assert= "bl1214: a successful 3-way merge never calls fallback!" 0 @fallback-calls))

(let [abort-calls (atom 0)
      fallback-calls (atom 0)
      result (master-main-reconcile-lib/absorb-with-merge!
              {:ff! (fn [] {:success false})
               :merge! (fn [] {:success false :error "conflict"})
               :abort! (fn [] (swap! abort-calls inc))
               :fallback! (fn [] (swap! fallback-calls inc) {:success true :outcome :rematched-refuse})})]
  (assert= "bl1214: a conflicting 3-way merge is aborted exactly once" 1 @abort-calls)
  (assert= "bl1214: a conflicting 3-way merge falls through to fallback! exactly once" 1 @fallback-calls)
  (assert= "bl1214: fallback!'s own result passes through verbatim"
           {:success true :outcome :rematched-refuse} result))

(let [result (master-main-reconcile-lib/absorb-with-merge!
              {:ff! (fn [] {:success false})
               :merge! (fn [] {:success false :error "conflict"})
               :abort! (fn [] nil)
               :fallback! (fn [] {:success false :error "reset failed" :outcome :rematch-bookkeeping})})]
  (assert= "bl1214: fallback!'s own FAILURE result also passes through verbatim"
           {:success false :error "reset failed" :outcome :rematch-bookkeeping} result))

;; BL-1120 (invariant 2): abort! is called ONLY after this function's own
;; merge! attempt failed, NEVER on the ff! path and never speculatively.
(let [ff-order (atom [])
      result (master-main-reconcile-lib/absorb-with-merge!
              {:ff! (fn [] (swap! ff-order conj :ff) {:success true})
               :merge! (fn [] (swap! ff-order conj :merge!-should-not-run) {:success true})
               :abort! (fn [] (swap! ff-order conj :abort!-should-not-run))
               :fallback! (fn [] (swap! ff-order conj :fallback!-should-not-run) {:success false})})]
  (assert= "bl1214 invariant 2: ff success calls nothing else at all" [:ff] @ff-order))

;; ── BL-1248: parse-enabled? - fails closed to disabled on everything but
;;    the exact literal "true" ────────────────────────────────────────────

(assert-true "parse-enabled?: \"true\" enables"
             (master-main-reconcile-lib/parse-enabled?
              "config master_main_reconcile_enabled true"))
(assert= "parse-enabled?: \"false\" stays disabled" false
         (master-main-reconcile-lib/parse-enabled?
          "config master_main_reconcile_enabled false"))
(assert= "parse-enabled?: absent key -> disabled" false
         (master-main-reconcile-lib/parse-enabled? ""))
(assert= "parse-enabled?: nil conf text -> disabled" false
         (master-main-reconcile-lib/parse-enabled? nil))
(assert= "parse-enabled?: empty value (no third token) -> disabled" false
         (master-main-reconcile-lib/parse-enabled?
          "config master_main_reconcile_enabled"))
(assert= "parse-enabled?: unrecognised value -> disabled" false
         (master-main-reconcile-lib/parse-enabled?
          "config master_main_reconcile_enabled banana"))
(assert= "parse-enabled?: other conf lines present, key still absent -> disabled" false
         (master-main-reconcile-lib/parse-enabled?
          "config master_main_reconcile_escalation_threshold 3\nconfig active_backlog_max_depth 5"))
(assert-true "parse-enabled?: key present among other lines -> reads correctly"
             (master-main-reconcile-lib/parse-enabled?
              "config active_backlog_max_depth 5\nconfig master_main_reconcile_enabled true\nconfig mutation_cooldown_days 3"))

;; ── BL-1248: sweep!'s 4-arity kill switch ────────────────────────────────

;; the switch off: merge! never fires on an otherwise-clean should-reconcile
;; tick, and the skip is logged.
(let [{:keys [calls logs adapters]} (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold false adapters)
  (assert= "sweep! disabled: merge! never fires on a should-reconcile tick" 0 (:merge! @calls))
  (assert-true "sweep! disabled: the skip is logged"
               (some #(clojure.string/includes? % "skipped-by-config") @logs)))

;; the switch off, invariant 1's own scenario: a commit reachable only from
;; local main stays reachable - proven at this layer as "merge! (the ONE
;; state-mutating adapter) never fires", the real-git half of the same
;; claim proven by test_handoffd_master_main_reconcile_wiring.sh.
(let [{:keys [calls adapters]} (mk-adapters {:ahead 3 :behind 4 :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold false adapters)
  (assert= "sweep! disabled: a genuine two-way divergence still never mutates" 0 (:merge! @calls)))

;; the switch off does NOT suppress divergence surfacing: a dirty-blocked
;; tick still surfaces and (past threshold) still escalates - this ticket's
;; own firm constraint that the switch governs the reconcile action only.
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 22
                                              :dirty-paths #{"seed.txt"}
                                              :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold false adapters)
  (assert= "sweep! disabled: dirty-blocked still surfaces (divergence notification is not suppressed)"
           1 (:surface! @calls))
  (assert= "sweep! disabled: dirty-blocked never calls merge!" 0 (:merge! @calls)))

(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 22
                                              :dirty-paths #{"seed.txt"}
                                              :merge-changed-paths #{"seed.txt"}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) 1 false adapters)
  (assert= "sweep! disabled: escalation past threshold still fires while the switch is off"
           1 (:escalate! @calls)))

;; the switch off still logs the drift line - only the reconcile ACTION is
;; skipped, not the observability that runs before the gate.
(let [{:keys [logs adapters]} (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold false adapters)
  (assert-true "sweep! disabled: the drift line still logs ahead/behind"
               (some #(clojure.string/includes? % "drift ahead=0 behind=22") @logs)))

;; an up-to-date tick is unaffected by the switch either way - nothing to
;; skip, since :should-reconcile is the only branch the switch guards.
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 0})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold false adapters)
  (assert= "sweep! disabled: an up-to-date tick still never calls merge! (nothing to skip)"
           0 (:merge! @calls)))

;; the switch explicitly on behaves like a should-reconcile tick always has.
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold true adapters)
  (assert= "sweep! explicitly enabled: reconciles exactly as before BL-1248"
           1 (:merge! @calls)))

;; the pre-existing 3-arity call site (used exhaustively above and by every
;; other production caller besides handoffd.bb) keeps reconciling by
;; default - the switch defaults ENABLED at this pure-lib layer; the
;; fail-closed-to-disabled contract lives in parse-enabled? and in the
;; shipped conf value, not in sweep!'s own arity default (BL-1248's own
;; constraint is about the CONFIG default, never about breaking every
;; existing caller of this lib that never heard of the switch).
(let [{:keys [calls adapters]} (mk-adapters {:ahead 0 :behind 22 :merge-result {:success true}})]
  (master-main-reconcile-lib/sweep! (mk-tmp) default-threshold adapters)
  (assert= "sweep! 3-arity (no enabled? arg): still reconciles, unaffected by BL-1248"
           1 (:merge! @calls)))

;; ── BL-1236: merge-verdict classifies git merge-tree --write-tree's exit
;;    code alone - never a diff read over merged content ─────────────────

(assert= "merge-verdict: exit 0 -> clean"
         :clean (master-main-reconcile-lib/merge-verdict 0))
(assert= "merge-verdict: exit 1 -> conflict"
         :conflict (master-main-reconcile-lib/merge-verdict 1))
(assert= "merge-verdict: exit 2 (simulation could not run) -> unavailable"
         :unavailable (master-main-reconcile-lib/merge-verdict 2))
(assert= "merge-verdict: exit 128 (e.g. unresolvable ref) -> unavailable"
         :unavailable (master-main-reconcile-lib/merge-verdict 128))
(assert= "merge-verdict: nil exit (adapter never ran) -> unavailable, never clean"
         :unavailable (master-main-reconcile-lib/merge-verdict nil))

;; ── BL-1236: absorb-dispatch-plan's new verdict-unavailable? never
;;    authorises a reset - checked after noop (an up-to-date/already-
;;    containing-origin tip needs no verdict at all) but before every
;;    branch whose eventual fallback is a reset (ff-absorb, refuse-rematch)
;;    or the replay-bookkeeping rematch ────────────────────────────────────

(assert= "absorb-dispatch-plan: unavailable verdict on a genuine two-way divergence blocks rather than attempting ff-absorb"
         :verdict-unavailable
         (master-main-reconcile-lib/absorb-dispatch-plan
          {:merge-head-present? false :behind 2 :ahead 1
           :tip-contains-origin? false :would-conflict? false
           :absorb-would-conflict? false :verdict-unavailable? true}))
(assert= "absorb-dispatch-plan: unavailable verdict on ahead=0 behind>0 also blocks, not ff-absorb"
         :verdict-unavailable
         (master-main-reconcile-lib/absorb-dispatch-plan
          {:merge-head-present? false :behind 3 :ahead 0
           :tip-contains-origin? false :would-conflict? false
           :absorb-would-conflict? false :verdict-unavailable? true}))
(assert= "absorb-dispatch-plan: unavailable verdict is irrelevant once tip already contains origin - stays noop"
         :noop
         (master-main-reconcile-lib/absorb-dispatch-plan
          {:merge-head-present? false :behind 3 :ahead 1
           :tip-contains-origin? true :would-conflict? false
           :absorb-would-conflict? false :verdict-unavailable? true}))
(assert= "absorb-dispatch-plan: unavailable verdict is irrelevant when nothing is behind - stays noop"
         :noop
         (master-main-reconcile-lib/absorb-dispatch-plan
          {:merge-head-present? false :behind 0 :ahead 0
           :tip-contains-origin? false :would-conflict? false
           :absorb-would-conflict? false :verdict-unavailable? true}))
(assert= "absorb-dispatch-plan: a foreign in-progress merge still wins over an unavailable verdict"
         :skip-human-merge-in-progress
         (master-main-reconcile-lib/absorb-dispatch-plan
          {:merge-head-present? true :behind 2 :ahead 1
           :tip-contains-origin? false :would-conflict? false
           :absorb-would-conflict? false :verdict-unavailable? true}))
(assert= "absorb-dispatch-plan: an omitted verdict-unavailable? key (production default) never blocks a genuine clean divergence"
         :ff-absorb
         (master-main-reconcile-lib/absorb-dispatch-plan
          {:merge-head-present? false :behind 2 :ahead 1
           :tip-contains-origin? false :would-conflict? false
           :absorb-would-conflict? false}))

;; ── BL-1236: an unavailable verdict is reported through its own reason,
;;    never folded into "conflict", and is not treated as designed rematch
;;    recovery (so it surfaces a note through handle-blocked!, same shape
;;    as "dirty") ────────────────────────────────────────────────────────

(assert= "merge-failure-reason: :verdict-unavailable outcome maps to its own reason, not conflict"
         "verdict-unavailable" (master-main-reconcile-lib/merge-failure-reason :verdict-unavailable))
(assert-true "rematch-owner-recovery?: verdict-unavailable is NOT a designed rematch recovery"
             (not (master-main-reconcile-lib/rematch-owner-recovery? "verdict-unavailable")))
(let [msg (master-main-reconcile-lib/surface-message {:behind 7 :reason :verdict-unavailable})]
  (assert-true "surface-message: verdict-unavailable names itself, not a conflict"
               (clojure.string/includes? msg "verdict unavailable"))
  (assert-true "surface-message: verdict-unavailable stays within the 80-char note limit" (<= (count msg) 80)))

;; ── report ───────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL TESTS PASS")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
