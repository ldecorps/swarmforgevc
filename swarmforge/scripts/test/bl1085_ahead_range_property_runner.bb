#!/usr/bin/env bb
;; BL-1085 properties: cached verdict equals a fresh gather for the same key;
;; invalidation on tip / ahead-set / incomplete; one enumerate per tick.

(require '[babashka.fs :as fs])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "push_sweep_ahead_range_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))

(defn gen-sha [s]
  (let [[n s'] (gen-int s 1000000)]
    [(format "%06x" n) s']))

(defn gen-shas [s]
  (let [[n s1] (gen-int s 6)]
    (loop [i 0 s s1 acc []]
      (if (= i n)
        [acc s]
        (let [[sha s'] (gen-sha s)]
          (recur (inc i) s' (conj acc sha)))))))

(defn gen-payload [s tip shas]
  (let [[complete? s1] (gen-bool s)
        [refuse? s2] (gen-bool s1)
        qa (if refuse?
             {:qa-ref-exists? true :facts-complete? complete? :tip-is-qa-ancestor? false
              :ahead-commits [{:sha (or (first shas) "x") :qa-ancestor? false :changed-paths ["a"]}]}
             {:qa-ref-exists? true :facts-complete? complete? :tip-is-qa-ancestor? false
              :ahead-commits (mapv (fn [sha] {:sha sha :qa-ancestor? true :changed-paths []}) shas)})
        noop {:facts-complete? complete? :ahead-commits []}]
    [{:complete? complete? :qa-facts qa :noop-facts noop
      :ahead-shas (vec shas) :main-tip tip}
     s2]))

(loop [i 0 s 11]
  (when (< i runs)
    (let [[tip s1] (gen-sha s)
          [shas s2] (gen-shas s1)
          [payload s3] (gen-payload s2 tip shas)
          key (push-sweep-ahead-range-lib/cache-key tip shas)
          cache (atom nil)
          tick (atom nil)
          enum-count (atom 0)
          deps {:cache-atom cache
                :tick-memo-atom tick
                :read-key! (fn [] key)
                :enumerate! (fn [_] (swap! enum-count inc) payload)}
          a (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)
          _ (push-sweep-ahead-range-lib/begin-tick! tick)
          b (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps)]
      ;; Within first resolve + same-tick second call covered by memo in unit tests.
      ;; Cross-tick: if complete, b replays and matches a's facts; else re-enumerates.
      (when (:complete? payload)
        (when (not= (:qa-facts a) (:qa-facts b))
          (swap! failures conj (str "FAIL complete replay qa mismatch\n  " (pr-str [a b]))))
        (when (not= (:noop-facts a) (:noop-facts b))
          (swap! failures conj (str "FAIL complete replay noop mismatch\n  " (pr-str [a b]))))
        (when-not (= 1 @enum-count)
          (swap! failures conj (str "FAIL complete should enumerate once\n  count=" @enum-count)))
        (when (:enumerated? b)
          (swap! failures conj (str "FAIL replay must not enumerate\n  " (pr-str b)))))
      (when-not (:complete? payload)
        (when-not (= 2 @enum-count)
          (swap! failures conj (str "FAIL incomplete must re-enumerate\n  count=" @enum-count))))
      ;; Reorder invalidates
      (when (and (:complete? payload) (>= (count shas) 2))
        (push-sweep-ahead-range-lib/begin-tick! tick)
        (let [reordered (push-sweep-ahead-range-lib/cache-key tip (vec (reverse shas)))
              deps2 (assoc deps :read-key! (fn [] reordered))
              before @enum-count
              _ (push-sweep-ahead-range-lib/resolve-ahead-range-facts! deps2)]
          (when-not (= (inc before) @enum-count)
            (swap! failures conj (str "FAIL reorder must invalidate\n  before=" before " after=" @enum-count)))))
      (recur (inc i) s3))))

(println (str "bl1085_ahead_range properties: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
