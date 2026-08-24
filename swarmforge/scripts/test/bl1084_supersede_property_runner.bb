#!/usr/bin/env bb
;; BL-1084 properties over supersede_lib turn-verdict.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "supersede_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def tasks ["BL-1052-qwen-code-seat" "BL-1099-unrelated" "BL-1084-a-superseded-task-stops-at-every-stage"
            "BL-1-x" "BL-999-other"])

(defn gen-store [s]
  (let [[kind s1] (gen-int s 3)]
    (case kind
      0 [{:status :absent} s1]
      1 [{:status :unreadable :detail "x"} s1]
      (let [[n s2] (gen-int s1 3)
            [entries s3]
            (loop [i 0 s s2 acc {}]
              (if (= i (inc n))
                [acc s]
                (let [[t s'] (gen-pick s tasks)
                      [r s''] (gen-pick s' ["reason-a" "reason-b" "reframed to local-model"])]
                  (recur (inc i) s'' (assoc acc t r)))))]
        [{:status :ok :entries entries} s3]))))

(defn gen-candidates [s]
  (let [[n s1] (gen-int s 4)]
    (loop [i 0 s s1 acc []]
      (if (= i n)
        [acc s]
        (let [[t s'] (gen-pick s tasks)]
          (recur (inc i) s' (conj acc t)))))))

(loop [i 0 s 7]
  (when (< i runs)
    (let [[store s1] (gen-store s)
          [cands s2] (gen-candidates s1)
          v (supersede-lib/turn-verdict store cands)]
      (case (:status store)
        :absent
        (when (not= v :ok)
          (swap! failures conj (str "FAIL absent must pass\n  " (pr-str [store cands v]))))

        :unreadable
        (when (or (not (map? v)) (not= :refused (:status v)) (not= :store-unreadable (:kind v)))
          (swap! failures conj (str "FAIL unreadable must refuse\n  " (pr-str [store cands v]))))

        :ok
        (let [hit (some #(when (contains? (:entries store) %) %) cands)]
          (if hit
            (when (or (not (map? v)) (not= :refused (:status v)) (not= :superseded (:kind v))
                      (not= hit (:task v)))
              (swap! failures conj (str "FAIL hit must refuse named task\n  " (pr-str [store cands v hit]))))
            (when (not= v :ok)
              (swap! failures conj (str "FAIL miss must pass\n  " (pr-str [store cands v])))))))
      (recur (inc i) s2))))

(println (str "bl1084_supersede properties: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
