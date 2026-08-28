#!/usr/bin/env bb
;; BL-1118: unit tests for post_hotfix_merge_origin_lib.bb

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "post_hotfix_merge_origin_lib.bb")))
(load-file (str (fs/path script-dir ".." "master_main_reconcile_lib.bb")))

(def failures (atom []))

(defn- assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg " expected=" (pr-str expected) " actual=" (pr-str actual)))))

(defn- assert-true [msg pred]
  (when-not pred
    (swap! failures conj (str "FAIL: " msg))))

(assert= "honest: empty dirty drops stale dirty surfaced"
         nil
         (post-hotfix-merge-origin-lib/honest-reconcile-surfaced #{} "dirty"))
(assert= "honest: dirty tree keeps dirty surfaced"
         "dirty"
         (post-hotfix-merge-origin-lib/honest-reconcile-surfaced #{"a.bb"} "dirty"))
(assert= "honest: conflict surfaced unchanged when clean"
         "conflict"
         (post-hotfix-merge-origin-lib/honest-reconcile-surfaced #{} "conflict"))

(assert= "plan: behind 0 -> noop"
         :noop (post-hotfix-merge-origin-lib/post-merge-plan 0))
(assert= "plan: behind >0 -> attempt-merge"
         :attempt-merge (post-hotfix-merge-origin-lib/post-merge-plan 3))

(assert= "conflicted paths from porcelain"
         ["swarmforge/scripts/a.bb" "x.ts"]
         (post-hotfix-merge-origin-lib/conflicted-paths-from-status
          "UU swarmforge/scripts/a.bb\nM  other.bb\nAA x.ts\n"))

(let [daemon (str (fs/create-temp-dir {:prefix "bl1118-daemon-"}))
      calls (atom [])
      behind-atom (atom 2)
      adapters {:daemon-dir daemon
                :fetch! (fn [] (swap! calls conj :fetch) {:exit 0})
                :rev-counts! (fn [] {:ahead 1 :behind @behind-atom})
                :dirty-paths! (fn [] [])
                :merge! (fn [] (swap! calls conj :merge)
                          (reset! behind-atom 0)
                          {:success true})
                :abort! (fn [] (swap! calls conj :abort))
                :status-porcelain! (fn [] "")
                :mid-merge? (fn [] false)}
      _ (master-main-reconcile-lib/write-deadlock! daemon {:active true :reason "dirty"})
      result (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)]
  (assert-true "success merges after fetch" (= [:fetch :merge] @calls))
  (assert-true "success ok" (:ok? result))
  (assert= "success exit 0" 0 (:exit result))
  ;; BL-1214 architect bounce D1: this scenario's :merge! (mapped to
  ;; absorb-with-merge!'s :ff! slot) succeeds alone - a plain fast-forward,
  ;; no divergence - which is outcome :ff, not :merged (:merged is only the
  ;; NEW non-conflicting-two-way-divergence case BL-1214 adds, via a real
  ;; :merge3! attempt after :ff! fails; not exercised by this scenario).
  (assert= "success outcome ff" :ff (:outcome result))
  (assert-true "deadlock cleared when behind 0"
               (not (master-main-reconcile-lib/deadlock-active?
                     (master-main-reconcile-lib/read-deadlock daemon)))))

(let [daemon (str (fs/create-temp-dir {:prefix "bl1118-conflict-"}))
      mid? (atom false)
      adapters {:daemon-dir daemon
                :fetch! (fn [] nil)
                :rev-counts! (fn [] {:ahead 1 :behind 2})
                :dirty-paths! (fn [] [])
                :merge! (fn [] (reset! mid? true)
                          {:success false :conflicted-paths ["a.bb"]})
                :abort! (fn [] (reset! mid? false))
                :status-porcelain! (fn [] "UU a.bb\n")
                :mid-merge? (fn [] @mid?)}
      result (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)]
  (assert-true "conflict not ok" (not (:ok? result)))
  (assert= "conflict exit 1" 1 (:exit result))
  (assert= "conflict outcome refuse-rematch" :refuse-rematch (:outcome result))
  (assert= "conflict paths" ["a.bb"] (:conflicted-paths result))
  (assert-true "not left mid-merge" (not (:mid-merge? result))))

(let [daemon (str (fs/create-temp-dir {:prefix "bl1130-preflight-"}))
      calls (atom [])
      adapters {:daemon-dir daemon
                :fetch! (fn [] (swap! calls conj :fetch))
                :rev-counts! (fn [] {:ahead 0 :behind 2})
                :dirty-paths! (fn [] [])
                :would-conflict! (fn [] true)
                :tip-contains-origin! (fn [] false)
                :merge! (fn [] (swap! calls conj :merge) {:success true})
                :abort! (fn [] (swap! calls conj :abort))
                :status-porcelain! (fn [] "")
                :mid-merge? (fn [] false)}
      result (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)]
  (assert= "preflight refuses without merge" [:fetch] @calls)
  (assert= "preflight outcome refuse-rematch" :refuse-rematch (:outcome result))
  (assert-true "preflight not mid-merge" (not (:mid-merge? result))))

;; BL-1131: local-ahead + conflict foresight → rematch bookkeeping, not operator merge.
(let [daemon (str (fs/create-temp-dir {:prefix "bl1131-replay-"}))
      calls (atom [])
      adapters {:daemon-dir daemon
                :fetch! (fn [] (swap! calls conj :fetch))
                :rev-counts! (fn [] {:ahead 1 :behind 2})
                :dirty-paths! (fn [] [])
                :would-conflict! (fn [] true)
                :tip-contains-origin! (fn [] false)
                :merge! (fn [] (swap! calls conj :merge) {:success true})
                :abort! (fn [] (swap! calls conj :abort))
                :status-porcelain! (fn [] "")
                :mid-merge? (fn [] false)}
      result (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)]
  (assert= "BL-1131 no merge on colliding ahead" [:fetch] @calls)
  (assert= "BL-1131 outcome rematch-bookkeeping" :rematch-bookkeeping (:outcome result))
  (assert-true "BL-1131 not mid-merge" (not (:mid-merge? result)))
  (assert-true "BL-1131 not operator absorb recovery"
               (not (master-main-reconcile-lib/designed-recovery-is-operator-absorb?
                     (:outcome result)))))

;; BL-1138: rematch! executes and clears behind/deadlock
(let [daemon (str (fs/create-temp-dir {:prefix "bl1138-rematch-"}))
      _ (master-main-reconcile-lib/write-deadlock! daemon
                                                   {:active true :reason "rematch-bookkeeping"})
      counts (atom {:ahead 1 :behind 2})
      calls (atom [])
      adapters {:daemon-dir daemon
                :fetch! (fn [] (swap! calls conj :fetch))
                :rev-counts! (fn [] @counts)
                :dirty-paths! (fn [] [])
                :would-conflict! (fn [] true)
                :tip-contains-origin! (fn [] false)
                :rematch! (fn []
                            (swap! calls conj :rematch)
                            (reset! counts {:ahead 0 :behind 0})
                            {:success true})
                :merge! (fn [] (swap! calls conj :merge) {:success true})
                :abort! (fn [] (swap! calls conj :abort))
                :status-porcelain! (fn [] "")
                :mid-merge? (fn [] false)}
      result (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)
      after (master-main-reconcile-lib/after-successful-rematch-status
             {:ahead (:ahead result) :behind (:behind result)
              :deadlock-was-active? true})
      dl (master-main-reconcile-lib/read-deadlock daemon)]
  (assert= "BL-1138 rematch called" [:fetch :rematch] @calls)
  (assert= "BL-1138 outcome rematched" :rematched-bookkeeping (:outcome result))
  (assert= "BL-1138 behind 0" 0 (:behind result))
  (assert-true "BL-1138 ok" (:ok? result))
  (assert= "BL-1138 sync proceed" :proceed (:sync-action after))
  (assert-true "BL-1138 deadlock cleared" (not (master-main-reconcile-lib/deadlock-active? dl))))

(let [daemon (str (fs/create-temp-dir {:prefix "bl1118-honest-"}))
      _ (master-main-reconcile-lib/write-state! daemon {:surfaced "dirty" :escalated true})
      adapters {:daemon-dir daemon
                :fetch! (fn [] nil)
                :rev-counts! (fn [] {:ahead 0 :behind 4})
                :dirty-paths! (fn [] [])
                :merge! (fn [] {:success true})
                :abort! (fn [] nil)
                :status-porcelain! (fn [] "")
                :mid-merge? (fn [] false)}
      _ (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)
      state (master-main-reconcile-lib/read-state daemon)
      action (master-main-reconcile-lib/sync-action
              {:ahead 0 :behind 4
               :reconcile-surfaced (:surfaced state)
               :reconcile-escalated (:escalated state)})]
  (assert= "stale dirty surfaced cleared when clean" nil (:surfaced state))
  (assert= "sync action is ff-only not wait-dirty-clear" :ff-only action))

(if (empty? @failures)
  (println "post_hotfix_merge_origin_lib (BL-1118): ALL TESTS PASSED")
  (do (println (str "post_hotfix_merge_origin_lib (BL-1118): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
