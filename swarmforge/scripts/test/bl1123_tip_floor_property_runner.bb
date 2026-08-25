#!/usr/bin/env bb
;; BL-1123 property: tip-floor verdict is monotone in count vs floor.

(require '[babashka.fs :as fs])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "master_checkout_integrity_lib.bb")))

(def failures (atom []))

(doseq [floor [1 10 100 500]
        n (range 0 (+ floor 5))]
  (let [v (master-checkout-integrity-lib/tip-floor-verdict n floor)
        expect (if (>= n floor) :allowed :refused)]
    (when (not= v expect)
      (swap! failures conj (str "n=" n " floor=" floor " got " v)))))

(if (empty? @failures)
  (println "bl1123_tip_floor_property: ALL TESTS PASSED")
  (do (doseq [f @failures] (println f)) (System/exit 1)))
