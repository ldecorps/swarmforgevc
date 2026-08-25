#!/usr/bin/env bb
;; BL-1131 properties: rematch-then-FF land never designs operator absorb recovery;
;; successful path reaches behind=0 / proceed; BL-1130 clean-refuse still holds.

(require '[babashka.fs :as fs])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "master_main_reconcile_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

(doseq [tip-ok? [true false]
        conflict? [true false]
        :let [plan (master-main-reconcile-lib/prepublish-rematch-plan
                    {:tip-contains-origin? tip-ok? :rematch-would-conflict? conflict?})]]
  (when (and tip-ok? (not= plan :already-contains-origin))
    (fail! (str "tip-ok must be already-contains-origin: " plan)))
  (when (and (not tip-ok?) conflict? (not= plan :refuse-lander))
    (fail! (str "conflict rematch must refuse-lander: " plan)))
  (when (and (not tip-ok?) (not conflict?) (not= plan :rematch-clean))
    (fail! (str "clean rematch must rematch-clean: " plan)))
  (when (and (= plan :refuse-lander)
             (master-main-reconcile-lib/may-publish-land-tip? plan))
    (fail! "refuse-lander must not publish")))

(doseq [ahead [0 1 3]
        behind [0 2]
        conflict? [true false]
        :let [plan (master-main-reconcile-lib/post-land-absorb-plan
                    {:behind behind :ahead ahead :tip-contains-origin? false
                     :absorb-would-conflict? conflict?})]]
  (when (and (zero? behind) (not= plan :noop))
    (fail! (str "behind 0 must noop: " plan)))
  (when (and (pos? behind) (zero? ahead) (not conflict?) (not= plan :ff-absorb))
    (fail! (str "behind-only clean must ff-absorb: " plan)))
  (when (and (pos? behind) (pos? ahead) conflict? (not= plan :replay-bookkeeping))
    (fail! (str "colliding ahead must replay-bookkeeping: " plan)))
  (when (master-main-reconcile-lib/designed-recovery-is-operator-absorb? plan)
    (fail! (str "absorb plan must not be operator absorb: " plan))))

(let [ok (master-main-reconcile-lib/land-pipeline-outcome
          {:prepublish-plan :rematch-clean :absorb-plan :ff-absorb :mid-merge? false})]
  (when-not (and (:ok? ok) (= 0 (:behind ok)) (= :proceed (:sync-action ok)))
    (fail! (str "success land must behind=0 proceed: " (pr-str ok))))
  (when (:designed-recovery-operator-absorb? ok)
    (fail! "success must not page operator absorb"))
  (when (:mid-merge? ok)
    (fail! "success must not leave MERGE_HEAD")))

(let [race (master-main-reconcile-lib/land-pipeline-outcome
            {:prepublish-plan :rematch-clean
             :absorb-plan :replay-bookkeeping :mid-merge? false})]
  (when-not (#{:rematch-bookkeeping-owner :rematch-lander} (:recovery race))
    (fail! (str "race recovery must rematch owner/lander: " (:recovery race))))
  (when (:designed-recovery-operator-absorb? race)
    (fail! "race must not page operator absorb"))
  (when (:mid-merge? race)
    (fail! "race must stay clean (BL-1130)")))

;; BL-1130 still holds on automated-absorb-plan.
(when-not (= :refuse-rematch
             (master-main-reconcile-lib/automated-absorb-plan
              {:merge-head-present? false :behind 2 :would-conflict? true
               :tip-contains-origin? false}))
  (fail! "BL-1130 conflict foresight must still refuse-rematch"))

(when (master-main-reconcile-lib/designed-recovery-is-operator-absorb?
       "BL-1130: absorb refused — rematch onto origin/main")
  (fail! "rematch refuse must not count as operator absorb"))

(when-not (master-main-reconcile-lib/designed-recovery-is-operator-absorb?
           "Complete origin/main merge: resolve AA")
  (fail! "operator Complete origin/main merge must be detected"))

(if (empty? @failures)
  (println "bl1131_ticket_land_property: ALL PROPERTIES HOLD")
  (do (println (str "bl1131_ticket_land_property: " (count @failures) " FAILURE(S)"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
