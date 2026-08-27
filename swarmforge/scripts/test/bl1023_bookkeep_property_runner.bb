#!/usr/bin/env bb
;; BL-1023 properties over bookkeep-plan / bookkeep-move-ok?.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def folders [nil "active" "paused" "hold" "done" "evidence"])
(def tickets ["BL-1023" "BL-1" "BL-999"])

(loop [i 0 s 19]
  (when (< i runs)
    (let [[folder s1] (gen-pick s folders)
          [ticket s2] (gen-pick s1 tickets)
          plan (expedite-lib/bookkeep-plan {:folder folder :ticket ticket})
          action (:action plan)]
      (case folder
        nil
        (when (or (not= :refuse action) (not (str/includes? (str (:message plan)) ticket)))
          (swap! failures conj (str "FAIL missing must refuse naming ticket\n  " (pr-str plan))))

        "active"
        (when (not= :ready action)
          (swap! failures conj (str "FAIL active must be ready\n  " (pr-str plan))))

        "paused"
        (when (or (not= :adopt action) (not= "paused" (:from plan)) (not= "active" (:to plan)))
          (swap! failures conj (str "FAIL paused must adopt\n  " (pr-str plan))))

        "hold"
        (when (or (not= :adopt action) (not= "hold" (:from plan)))
          (swap! failures conj (str "FAIL hold must adopt\n  " (pr-str plan))))

        ;; unexpected folders refuse
        (when (not= :refuse action)
          (swap! failures conj (str "FAIL unexpected folder must refuse\n  " (pr-str plan)))))
      ;; move-ok? never treats nil / missing :ok? as success
      (when (expedite-lib/bookkeep-move-ok? nil)
        (swap! failures conj "FAIL nil move must not be ok"))
      (when (expedite-lib/bookkeep-move-ok? {:ok? false})
        (swap! failures conj "FAIL :ok? false must not be ok"))
      (when-not (expedite-lib/bookkeep-move-ok? {:ok? true})
        (swap! failures conj "FAIL :ok? true must be ok"))
      (recur (inc i) s2))))

(println (str "bl1023_bookkeep properties: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
