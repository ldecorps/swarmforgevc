#!/usr/bin/env bb
;; BL-655: PROPERTY test for the FIRST declared invariant's queue-level
;; half - "every parcel attributed to another ticket is still present,
;; byte-identical, in the queue it occupied - never delivered onward,
;; dropped, quarantined, abandoned or rewritten." ambulance_lib_property_
;; runner.bb already proves the pure hold predicate is sound (P1); this file
;; proves the REAL dequeue-site wiring (handoff-lib/resolve-dequeueable-
;; candidates, site 2 of the three required read sites) never loses or
;; mutates a held file on disk, against randomly generated mixed batches of
;; held/free parcels - real fs I/O, no mocks.
;;
;; Same seeded-LCG convention as ambulance_lib_property_runner.bb /
;; expedite_lib_property_runner.bb (deterministic, never rand). See that
;; file's header for the Babashka-property-tooling-gap note (BL-472) this
;; one shares.

(ns ambulance-wiring-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "ambulance-wiring-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(def ambulance-ticket "BL-654")
(def other-tickets ["BL-660" "BL-700"])

(defn gen-batch
  "1..6 parcels, each independently for the ambulance ticket or a different
   one - a mixed batch, which is exactly the shape ambulance-hold-01/07 test."
  [s]
  (let [[n s1] (gen-int s 6)]
    (reduce (fn [[acc sx] i]
              (let [[for-ambulance? sy] (gen-pick sx [true false])
                    [other sz] (gen-pick sy other-tickets)
                    task (if for-ambulance? ambulance-ticket other)]
                [(conj acc {:index i :task task :for-ambulance? for-ambulance?}) sz]))
            [[] s1] (range (inc n)))))

(defn git-handoff-content [task commit]
  (str "id: 20260726T000000Z_" (format "%06d" (hash task)) "_from_specifier\n"
       "from: specifier\nto: coder\npriority: 50\ntype: git_handoff\n"
       "task: " task "\ncommit: " commit "\n"
       "created_at: 2026-07-26T00:00:00Z\nenqueued_at: 2026-07-26T00:00:02Z\n"
       "\nmerge_and_process specifier " commit "\n"))

(check-all "P1-wiring non-loss: resolve-dequeueable-candidates never moves or mutates a held parcel" gen-batch
  (fn [batch]
    (let [dir (mk-tmp)
          held-state {:active true :ticket ambulance-ticket}
          held?-fn (fn [content]
                     (ambulance-lib/parcel-held? held-state (handoff-lib/parse-envelope content)))
          files (mapv (fn [{:keys [index task]}]
                        (let [f (fs/path dir (format "50_%03d_from_specifier_to_coder.handoff" index))
                              content (git-handoff-content task "commit0000")]
                          (spit (str f) content)
                          {:file f :content content :task task}))
                      batch)
          before-contents (into {} (map (fn [{:keys [file content]}] [file content]) files))
          dequeued (set (handoff-lib/resolve-dequeueable-candidates (mapv :file files) [] []
                                                                     (constantly true) held?-fn))
          expected-dequeued (set (map :file (filter #(= ambulance-ticket (:task %)) files)))
          held-files (map :file (filter #(not= ambulance-ticket (:task %)) files))
          problems (concat
                    (when (not= dequeued expected-dequeued)
                      [(str "dequeued " (pr-str dequeued) " != expected " (pr-str expected-dequeued))])
                    (keep (fn [f]
                            (cond
                              (not (fs/exists? f)) (str "held file vanished: " f)
                              (not= (get before-contents f) (slurp (str f)))
                              (str "held file content changed: " f)
                              :else nil))
                          held-files))]
      (if (empty? problems) true (str/join "; " problems)))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "ambulance wiring properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
