#!/usr/bin/env bb
;; BL-1898: PROPERTY tests over the two invariants the ticket YAML declares
;; (coder-authored first, per BL-654).
;;
;;   P1 "A land record opens the close only of the ticket it names, and only
;;      when its commit is an ancestor of main." Over a real store of random
;;      records, the verdict (no mailbox, no expedite record) is allowed iff
;;      some record names exactly the asked ticket AND its commit is on main.
;;   P2 "A missing or unreadable land record never turns a refusal into a
;;      pass." One corrupt line, at a random position, in a store that would
;;      otherwise approve, always refuses as a land store problem.
;;
;; GENERATOR REACH. Near-miss tickets are CONSTRUCTED from the asked id by the
;; transformations an id match could conflate (prefix, suffix, case, digit
;; drop), never drawn independently - every one is a collision candidate. The
;; run fails unless allowed, a near-miss-only refusal and a
;; matching-but-off-main refusal were all generated.

(ns bl1898-land-record-close-guard-property-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ticket_close_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def seed0 (or (some-> (System/getenv "PROPERTY_SEED") parse-long) (mod (System/currentTimeMillis) 2147483648)))
(def failures (atom []))
(def reached (atom #{}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def asked "BL-9001")
(def near-misses ["BL-90010" "BL-900" "bl-9001" "XBL-9001" "BL-9001 " "BL-9002"])

(def root (str (fs/create-temp-dir {:prefix "bl1898-prop-"})))
(.addShutdownHook (Runtime/getRuntime) (Thread. #(fs/delete-tree root)))
(def store-file (str (fs/path root ".swarmforge" "land-approvals" "2026-10.jsonl")))
(fs/create-dirs (fs/parent store-file))

(defn- verdict-for [lines on-main]
  (spit store-file (str (str/join "\n" lines) "\n"))
  (let [land (ticket-close-guard-lib/land-approval root asked)]
    (ticket-close-guard-lib/close-verdict
     {:qa-mailbox? false :store {:kind :absent} :ancestor? nil
      :land land
      :land-record (when (= :approved (:kind land))
                     (ticket-close-guard-lib/land-record-on-main (:records land) #(get on-main %)))})))

(defn- gen-records [s]
  (let [[n s] (gen-int s 5)]
    (loop [k 0 s s acc []]
      (if (> k n)
        [acc s]
        (let [[exact? s] (gen-int s 3)
              [miss s] (gen-pick s near-misses)
              [main? s] (gen-int s 2)]
          (recur (inc k) s (conj acc {:ticket (if (zero? exact?) asked miss)
                                      :commit (format "c%09d" k)
                                      :on-main (= 1 main?)})))))))

(def corruptions ["not a record" "{\"commit\":\"c000000000\"}" "{\"ticket\":\"BL-9001\"}" "[1,2]" "{\"ticket\":9001,\"commit\":\"c\"}"])

(loop [i 0 s seed0]
  (when (< i runs)
    (let [[recs s] (gen-records s)
          on-main (into {} (map (juxt :commit :on-main) recs))
          lines (mapv #(json/generate-string (select-keys % [:ticket :commit])) recs)
          expected (boolean (some #(and (= asked (:ticket %)) (:on-main %)) recs))
          v (verdict-for lines on-main)]
      (when (not= expected (boolean (:allowed? v)))
        (swap! failures conj (str "FAIL P1 seed " seed0 " run " i ": " (pr-str recs) " -> " (pr-str v))))
      (swap! reached conj (cond expected :allowed
                                (some #(= asked (:ticket %)) recs) :named-off-main
                                (seq recs) :near-miss-only
                                :else :empty))
      ;; P2: the same store plus one corrupt line anywhere.
      (let [[bad s2] (gen-pick s corruptions)
            [pos s3] (gen-int s2 (inc (count lines)))
            v2 (verdict-for (vec (concat (take pos lines) [bad] (drop pos lines))) on-main)]
        (when (or (:allowed? v2) (not= :land-store-problem (:reason v2)))
          (swap! failures conj (str "FAIL P2 seed " seed0 " run " i ": " (pr-str bad) " at " pos " -> " (pr-str v2))))
        (when expected (swap! reached conj :corrupt-would-have-approved))
        (recur (inc i) s3)))))

(doseq [need [:allowed :named-off-main :near-miss-only :corrupt-would-have-approved]]
  (when-not (contains? @reached need)
    (swap! failures conj (str "REACH: the generator never produced " need " (seed " seed0 ")"))))

(if (seq @failures)
  (do (doseq [f (take 10 @failures)] (println f))
      (println (count @failures) "failure(s)")
      (System/exit 1))
  (println "ALL PASS: BL-1898 land record close guard properties," runs "runs, seed" seed0))
