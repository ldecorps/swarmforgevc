#!/usr/bin/env bb
;; BL-1118: property — honest-reconcile-surfaced clears a stale *dirty*
;; reason on a clean tree so sync-action is never wait-dirty-clear for that
;; case. Conflict surfaced is a different signal (unit-locked) and may remain.

(require '[babashka.fs :as fs])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "post_hotfix_merge_origin_lib.bb")))
(load-file (str (fs/path script-dir ".." "master_main_reconcile_lib.bb")))

(def failures (atom []))

(defn- fail! [msg]
  (swap! failures conj msg))

;; Exhaustive small grid: dirty empty/non-empty × surfaced dirty/conflict/nil × ahead/behind
(doseq [dirty [#{} #{"a.bb"}]
        surfaced [nil "dirty" "conflict"]
        ahead [0 2]
        behind [0 3]]
  (let [honest (post-hotfix-merge-origin-lib/honest-reconcile-surfaced dirty surfaced)
        action (master-main-reconcile-lib/sync-action
                {:ahead ahead :behind behind
                 :reconcile-surfaced honest
                 :reconcile-escalated (= honest "dirty")})]
    ;; Stale dirty on a clean tip must clear — never leave wait-dirty-clear.
    (when (and (empty? dirty) (= "dirty" (str surfaced)))
      (when (not (nil? honest))
        (fail! (str "clean tree must drop stale dirty surfaced: "
                    (pr-str {:dirty dirty :surfaced surfaced :honest honest}))))
      (when (and (pos? behind) (= action :wait-dirty-clear))
        (fail! (str "clean behind after dirty-clear must not wait-dirty-clear: "
                    (pr-str {:dirty dirty :surfaced surfaced :honest honest :action action})))))
    ;; Dirty tree keeps dirty and may wait-dirty-clear when behind.
    (when (and (seq dirty) (= "dirty" (str surfaced)) (not= honest "dirty"))
      (fail! (str "dirty tree must keep dirty surfaced: "
                  (pr-str {:dirty dirty :surfaced surfaced :honest honest}))))))

(if (empty? @failures)
  (println "bl1118_post_hotfix_merge_property: ALL TESTS PASSED")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
