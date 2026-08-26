#!/usr/bin/env bb
;; BL-1085 acceptance CLI: drives push_sweep_ahead_range_lib with a counting
;; enumerate! so scenarios can assert walk-once / replay / invalidation
;; without shelling real git. Prints PASS markers consumed by the fixture
;; and by bl1085PushSweepCachesSteps.js.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "push_sweep_ahead_range_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "push_sweep_lib.bb")))

(def failures (atom []))
(defn pass! [m] (println (str "PASS: " m)))
(defn fail! [m] (swap! failures conj m) (println (str "FAIL: " m)))

(def tip "t0000001")
(def shas ["a0000001" "a0000002" "a0000003" "a0000004" "a0000005"])
(def key (push-sweep-ahead-range-lib/cache-key tip shas))

(defn non-qa-payload []
  {:complete? true
   :qa-facts {:qa-ref-exists? true :facts-complete? true :tip-is-qa-ancestor? false
              :ahead-commits [{:sha "a0000001" :qa-ancestor? false :bounced? false
                               :changed-paths ["extension/src/x.ts"]}
                              {:sha "a0000002" :qa-ancestor? true :bounced? false :changed-paths []}
                              {:sha "a0000003" :qa-ancestor? true :bounced? false :changed-paths []}
                              {:sha "a0000004" :qa-ancestor? true :bounced? false :changed-paths []}
                              {:sha "a0000005" :qa-ancestor? true :bounced? false :changed-paths []}]}
   :noop-facts {:facts-complete? true :ahead-commits []}
   :ahead-shas shas
   :main-tip tip})

(defn run-tick [cache tick enum-count read-key payload]
  (push-sweep-ahead-range-lib/begin-tick! tick)
  (let [deps {:cache-atom cache
              :tick-memo-atom tick
              :read-key! read-key
              :enumerate! (fn [_] (swap! enum-count inc) payload)}
        ;; Both gates resolve through the shared gatherer (one walk).
        _ (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)
        p (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)
        qa (push-sweep-lib/qa-gate-decision (:qa-facts p))
        noop (push-sweep-lib/noop-merge-decision (:noop-facts p))]
    {:payload p :qa qa :noop noop :enum-count @enum-count}))

;; ── 01: first refusing tick enumerates ───────────────────────────────────
(let [cache (atom nil) tick (atom nil) n (atom 0)
      r (run-tick cache tick n (fn [] key) (non-qa-payload))]
  (if (and (:enumerated? (:payload r))
           (= 1 (:enum-count r))
           (:refuse? (:qa r))
           (= :non-qa-ancestor (:reason (:qa r))))
    (pass! "01: first refusing tick enumerates and refuses non-qa-ancestor")
    (fail! (str "01: " (pr-str r)))))

;; ── 02: unchanged inputs replay without enumerating ──────────────────────
(let [cache (atom nil) tick (atom nil) n (atom 0)
      _ (run-tick cache tick n (fn [] key) (non-qa-payload))
      r (run-tick cache tick n (fn [] key) (non-qa-payload))]
  (if (and (not (:enumerated? (:payload r)))
           (= 1 (:enum-count r))
           (:refuse? (:qa r))
           (= :non-qa-ancestor (:reason (:qa r))))
    (pass! "02: unchanged inputs replay without enumerating")
    (fail! (str "02: " (pr-str r)))))

;; ── 03: tip move / shrink / reorder force re-enumeration ─────────────────
(let [cache (atom nil) tick (atom nil) n (atom 0)
      _ (run-tick cache tick n (fn [] key) (non-qa-payload))
      tip-moved (push-sweep-ahead-range-lib/cache-key "t0000002" shas)
      r1 (run-tick cache tick n (fn [] tip-moved) (non-qa-payload))
      shrink (push-sweep-ahead-range-lib/cache-key tip (vec (drop 1 shas)))
      r2 (run-tick cache tick n (fn [] shrink) (non-qa-payload))
      reorder (push-sweep-ahead-range-lib/cache-key tip (vec (reverse shas)))
      r3 (run-tick cache tick n (fn [] reorder) (non-qa-payload))]
  (if (and (:enumerated? (:payload r1))
           (:enumerated? (:payload r2))
           (:enumerated? (:payload r3))
           (= 4 @n))
    (pass! "03: tip move / ahead shrink / reorder force fresh enumeration")
    (fail! (str "03: n=" @n " r1=" (pr-str r1) " r2=" (pr-str r2) " r3=" (pr-str r3)))))

;; ── 04: incomplete gather never cached ───────────────────────────────────
(let [cache (atom nil) tick (atom nil) n (atom 0)
      incomplete (assoc (non-qa-payload) :complete? false
                        :qa-facts {:qa-ref-exists? true :facts-complete? false})
      _ (run-tick cache tick n (fn [] key) incomplete)
      r (run-tick cache tick n (fn [] key) incomplete)]
  (if (and (= 2 (:enum-count r)) (:enumerated? (:payload r)))
    (pass! "04: incomplete gather is never cached")
    (fail! (str "04: " (pr-str r)))))

;; ── 05: one walk per tick for both gates ─────────────────────────────────
(let [cache (atom nil) tick (atom nil) n (atom 0)
      r (run-tick cache tick n (fn [] key) (non-qa-payload))]
  (if (= 1 (:enum-count r))
    (pass! "05: gathering tick walks ahead range exactly once for both gates")
    (fail! (str "05: enum-count=" (:enum-count r)))))

;; ── 06: cached verdict equals full re-gather (four shapes) ───────────────
(defn shape-payload [shape]
  (case shape
    :non-qa (non-qa-payload)
    :bounced
    {:complete? true
     :qa-facts {:qa-ref-exists? true :facts-complete? true :tip-is-qa-ancestor? false
                :ahead-commits [{:sha "a0000001" :qa-ancestor? true :bounced? true
                                 :changed-paths ["extension/src/x.ts"]}]}
     :noop-facts {:facts-complete? true :ahead-commits []}
     :ahead-shas shas :main-tip tip}
    :noop-merge
    {:complete? true
     :qa-facts {:qa-ref-exists? true :facts-complete? true :tip-is-qa-ancestor? false
                :ahead-commits [{:sha "a0000001" :qa-ancestor? true :bounced? false
                                 :changed-paths [] :merge? true}]}
     :noop-facts {:facts-complete? true
                  :ahead-commits [{:sha "a0000001" :merge? true
                                   :second-parent-sha "bbbbbbbb"
                                   :offered-paths ["x"] :tree-equals-parent1? true}]}
     :ahead-shas shas :main-tip tip}
    :only-qa
    {:complete? true
     :qa-facts {:qa-ref-exists? true :facts-complete? true :tip-is-qa-ancestor? false
                :ahead-commits (mapv (fn [s] {:sha s :qa-ancestor? true :bounced? false
                                              :changed-paths []}) shas)}
     :noop-facts {:facts-complete? true :ahead-commits []}
     :ahead-shas shas :main-tip tip}))

(doseq [shape [:non-qa :bounced :noop-merge :only-qa]]
  (let [payload (shape-payload shape)
        cache (atom nil) tick (atom nil) n (atom 0)
        with-cache (run-tick cache tick n (fn [] key) payload)
        ;; cache disabled: fresh atoms every time
        no-cache (run-tick (atom nil) (atom nil) (atom 0) (fn [] key) payload)
        qa-a (:qa with-cache) qa-b (:qa no-cache)
        noop-a (:noop with-cache) noop-b (:noop no-cache)]
    ;; Second tick with cache enabled should still match disabled
    (let [replay (run-tick cache tick n (fn [] key) payload)]
      (if (and (= qa-a qa-b) (= noop-a noop-b)
               (= (:qa replay) qa-b) (= (:noop replay) noop-b))
        (pass! (str "06: cached verdict equals full re-gather for " (name shape)))
        (fail! (str "06 " (name shape) ": " (pr-str {:a qa-a :b qa-b :replay (:qa replay)})))))))

(when (seq @failures)
  (println (str (count @failures) " FAILURE(S)"))
  (System/exit 1))
(println "ALL CLI SCENARIOS PASSED")
