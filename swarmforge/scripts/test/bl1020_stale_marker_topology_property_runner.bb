#!/usr/bin/env bb
;; BL-1020 property: on a pack whose rotation is empty (not a router), no
;; resolve-resident-role outcome treats mono-router-active-role as authoritative.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def roles ["coder" "specifier" "cleaner" "architect" "QA" "documenter"])

(defn gen-input [s]
  (let [[router? s1] (gen-bool s)
        [home s2] (gen-pick s1 roles)
        [has-marker? s3] (gen-bool s2)
        [recorded s4] (if has-marker?
                        (gen-pick s3 roles)
                        [nil s3])
        [blank? s5] (gen-bool s4)
        recorded' (cond (not has-marker?) nil
                        blank? "  "
                        :else recorded)]
    [{:rotation-router? router? :home-role home :recorded-role recorded'} s5]))

(loop [i 0 s 7]
  (when (< i runs)
    (let [[{:keys [rotation-router? home-role recorded-role] :as input} s'] (gen-input s)
          r (mono-router-lib/resolve-resident-role input)
          recorded (some-> recorded-role str str/trim not-empty)]
      (cond
        (not rotation-router?)
        (do
          (when (:honour-marker? r)
            (swap! failures conj (str "FAIL standing pack honoured marker\n  input: " (pr-str input)
                                      "\n  result: " (pr-str r))))
          (when (not= (:role r) home-role)
            (swap! failures conj (str "FAIL standing pack role not from pack config\n  input: " (pr-str input)
                                      "\n  result: " (pr-str r))))
          (when (not= (:stale? r) (boolean recorded))
            (swap! failures conj (str "FAIL standing pack stale? mismatch\n  input: " (pr-str input)
                                      "\n  result: " (pr-str r)))))

        recorded
        (when (or (not (:honour-marker? r)) (not= (:role r) recorded) (:stale? r))
          (swap! failures conj (str "FAIL router did not honour marker\n  input: " (pr-str input)
                                    "\n  result: " (pr-str r))))

        :else
        (when (or (:honour-marker? r) (:stale? r) (not= (:role r) home-role))
          (swap! failures conj (str "FAIL router without marker\n  input: " (pr-str input)
                                    "\n  result: " (pr-str r)))))
      (recur (inc i) s'))))

(println (str "bl1020_stale_marker_topology properties: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
