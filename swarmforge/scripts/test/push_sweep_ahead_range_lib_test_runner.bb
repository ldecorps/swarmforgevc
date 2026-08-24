#!/usr/bin/env bb
;; BL-1085 unit tests for push_sweep_ahead_range_lib.bb

(require '[babashka.fs :as fs])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "push_sweep_ahead_range_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg v]
  (when-not v
    (swap! failures conj (str "FAIL: " msg "\n  expected truthy, got: " (pr-str v)))))

(def tip "aaaa1111")
(def shas ["s1" "s2" "s3" "s4" "s5"])
(def key (push-sweep-ahead-range-lib/cache-key tip shas))

(def sample-payload
  {:complete? true
   :qa-facts {:qa-ref-exists? true :facts-complete? true :tip-is-qa-ancestor? false
              :ahead-commits [{:sha "s1" :qa-ancestor? false :changed-paths ["x"]}]}
   :noop-facts {:facts-complete? true :ahead-commits []}
   :ahead-shas (vec shas)
   :main-tip tip})

;; ── cache-key / cache-hit? ───────────────────────────────────────────────
(assert= "cache-key vectors ahead-shas"
         {:main-tip tip :ahead-shas ["s1" "s2"]}
         (push-sweep-ahead-range-lib/cache-key tip ["s1" "s2"]))

(assert-true "cache-hit? false for nil"
             (not (push-sweep-ahead-range-lib/cache-hit? nil key)))

(assert-true "cache-hit? false when incomplete"
             (not (push-sweep-ahead-range-lib/cache-hit?
                   {:key key :complete? false :payload sample-payload} key)))

(assert-true "cache-hit? false when tip differs"
             (not (push-sweep-ahead-range-lib/cache-hit?
                   {:key key :complete? true :payload sample-payload}
                   (push-sweep-ahead-range-lib/cache-key "other" shas))))

(assert-true "cache-hit? false when ahead set reordered"
             (not (push-sweep-ahead-range-lib/cache-hit?
                   {:key key :complete? true :payload sample-payload}
                   (push-sweep-ahead-range-lib/cache-key tip (reverse shas)))))

(assert-true "cache-hit? true for exact key"
             (push-sweep-ahead-range-lib/cache-hit?
              {:key key :complete? true :payload sample-payload} key))

;; ── next-cache-entry ─────────────────────────────────────────────────────
(assert= "next-cache-entry stores complete payload without enumerated?"
         {:key key :complete? true :payload (dissoc sample-payload :enumerated?)}
         (push-sweep-ahead-range-lib/next-cache-entry key (assoc sample-payload :enumerated? true)))

(assert= "next-cache-entry clears on incomplete"
         nil
         (push-sweep-ahead-range-lib/next-cache-entry key (assoc sample-payload :complete? false)))

;; ── resolve: first tick enumerates; second replays ───────────────────────
(def enum-count (atom 0))
(def cache (atom nil))
(def tick (atom nil))

(defn make-deps [read-key enumerate]
  {:cache-atom cache
   :tick-memo-atom tick
   :read-key! read-key
   :enumerate! (fn [k]
                 (swap! enum-count inc)
                 (enumerate k))})

(reset! enum-count 0)
(reset! cache nil)
(reset! tick nil)
(let [deps (make-deps (fn [] key) (fn [_] sample-payload))
      first (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)]
  (assert-true "first resolve enumerates" (:enumerated? first))
  (assert= "first resolve enum count" 1 @enum-count)
  (assert= "first resolve qa reason shape" false (get-in first [:qa-facts :tip-is-qa-ancestor?]))
  ;; same tick, second gate call — memo, no re-enumerate
  (let [second (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)]
    (assert= "same-tick second call shares memo" 1 @enum-count)
    (assert-true "same-tick still marked enumerated from first" (:enumerated? second)))
  ;; new tick, unchanged key — replay
  (push-sweep-ahead-range-lib/begin-tick! tick)
  (let [replayed (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)]
    (assert= "replay does not re-enumerate" 1 @enum-count)
    (assert-true "replay marks enumerated? false" (not (:enumerated? replayed)))
    (assert= "replay keeps qa facts"
             (:qa-facts sample-payload)
             (:qa-facts replayed))))

;; tip move forces re-enumerate
(push-sweep-ahead-range-lib/begin-tick! tick)
(let [new-key (push-sweep-ahead-range-lib/cache-key "bbbb2222" shas)
      deps (make-deps (fn [] new-key) (fn [_] sample-payload))
      r (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)]
  (assert-true "tip move enumerates" (:enumerated? r))
  (assert= "tip move enum count" 2 @enum-count))

;; incomplete never cached — next tick re-enumerates
(reset! enum-count 0)
(reset! cache nil)
(reset! tick nil)
(let [deps (make-deps (fn [] key)
                      (fn [_] (assoc sample-payload :complete? false)))]
  (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)
  (assert= "incomplete leaves cache nil" nil @cache)
  (push-sweep-ahead-range-lib/begin-tick! tick)
  (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)
  (assert= "incomplete forces re-enumerate next tick" 2 @enum-count))

;; read-key failure
(reset! tick nil)
(let [deps (make-deps (fn [] nil) (fn [_] (throw (ex-info "should not enumerate" {}))))
      r (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)]
  (assert-true "read-key fail is incomplete" (not (:complete? r)))
  (assert-true "read-key fail does not enumerate" (not (:enumerated? r))))

(println "push_sweep_ahead_range_lib_test_runner")
(if (empty? @failures)
  (do (println "ALL TESTS PASSED") (System/exit 0))
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
