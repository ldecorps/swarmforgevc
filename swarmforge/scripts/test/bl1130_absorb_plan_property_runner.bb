#!/usr/bin/env bb
;; BL-1130: property — automated absorb plans never leave editor recovery.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "master_main_reconcile_lib.bb")))

(def failures (atom []))

(defn- fail! [msg]
  (swap! failures conj msg))

(def cases
  [{:merge-head-present? true :behind 3 :would-conflict? true :tip-contains-origin? false}
   {:merge-head-present? false :behind 0 :would-conflict? true :tip-contains-origin? false}
   {:merge-head-present? false :behind 2 :would-conflict? true :tip-contains-origin? false}
   {:merge-head-present? false :behind 2 :would-conflict? false :tip-contains-origin? false}
   {:merge-head-present? false :behind 0 :would-conflict? false :tip-contains-origin? true}
   {:merge-head-present? false :behind 4 :would-conflict? false :tip-contains-origin? true}])

(doseq [c cases]
  (let [plan (master-main-reconcile-lib/automated-absorb-plan c)]
    (when (= plan :refuse-rematch)
      (when-not (master-main-reconcile-lib/absorb-outcome-names-rematch-or-refuse? plan)
        (fail! (str "refuse plan must name rematch/refuse: " (pr-str c)))))
    (when (and (:would-conflict? c) (not (:merge-head-present? c)) (pos? (:behind c))
               (not (:tip-contains-origin? c)))
      (when (not= plan :refuse-rematch)
        (fail! (str "conflict foresight must refuse: " (pr-str c) " got " plan))))
    (when (or (zero? (:behind c)) (:tip-contains-origin? c))
      (when (and (not (:merge-head-present? c)) (not= plan :noop))
        (fail! (str "prepared/up-to-date must noop: " (pr-str c) " got " plan))))))

(doseq [msg ["BL-1130: absorb refused — rematch onto origin/main, 2 behind"
             :refuse-rematch
             "refuse-rematch"]]
  (when-not (master-main-reconcile-lib/absorb-outcome-names-rematch-or-refuse? msg)
    (fail! (str "expected rematch/refuse vocabulary: " (pr-str msg)))))

(when (master-main-reconcile-lib/absorb-outcome-names-rematch-or-refuse?
       "finish this merge in an editor")
  (fail! "editor recovery must not count as rematch/refuse"))

(when-not (master-main-reconcile-lib/post-absorb-clean? false 0)
  (fail! "clean post-absorb must pass"))
(when (master-main-reconcile-lib/post-absorb-clean? true 0)
  (fail! "MERGE_HEAD must fail post-absorb-clean"))
(when (master-main-reconcile-lib/post-absorb-clean? false 2)
  (fail! "unmerged paths must fail post-absorb-clean"))

(if (empty? @failures)
  (println "bl1130_absorb_plan_property: ALL TESTS PASSED")
  (do (println (str "bl1130_absorb_plan_property: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
