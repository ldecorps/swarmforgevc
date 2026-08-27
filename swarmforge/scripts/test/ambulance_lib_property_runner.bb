#!/usr/bin/env bb
;; BL-655: PROPERTY tests over ambulance_lib.bb, covering the three
;; invariants the ticket YAML declares (coder-authored first, per BL-654):
;;
;;   P1 attribution-soundness - the hold predicate exactly matches the
;;      ticket's own attribution rule (an independent oracle formula, not a
;;      copy of parcel-held?'s implementation).
;;   P2 engage!/release! idempotence and order-independence - repeating the
;;      SAME operation any number of times converges after the first
;;      application and stays byte-identical thereafter.
;;   P3 freshness - read-ambulance-state never reflects anything but the
;;      state ACTUALLY on disk at the moment of the call; a sequence of
;;      unrelated ops never leaves a stale value visible from an earlier op.
;;
;; Modeled on expedite_lib_property_runner.bb's own seeded-LCG convention
;; (deterministic, never rand - a flaky property is worse than none).
;;
;; NOTE on toolchain (per swarmforge/constitution's engineering article,
;; "Babashka/Clojure (swarm scripts)" - BL-472 tracks pinning real
;; mutation/property tooling for .bb scripts, deliberately deferred, not
;; wired today): the BL-654 role contract's "*.property.test.js /
;; vitest.properties.config.mjs" home is a TypeScript convention with no
;; Babashka equivalent. This file follows the property-test precedent this
;; repo already established for .bb code instead (expedite_lib_property_runner.bb,
;; BL-567 architect pass) - a hand-rolled seeded generator in the same
;; swarmforge/scripts/test/ suite that is the actual enforced gate for .bb
;; scripts, per that engineering-article note.

(ns ambulance-lib-property-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ambulance_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "ambulance-lib-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-ticket! [root ticket-id]
  (fs/create-dirs (fs/path root "backlog" "active"))
  (spit (str (fs/path root "backlog" "active" (str ticket-id "-demo.yaml")))
        (str "id: " ticket-id "\ntitle: \"demo\"\nstatus: active\n")))

;; ── seeded generator (identical LCG shape to expedite_lib_property_runner.bb) ──

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
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

;; Small alphabet so BOTH "attributed to the ambulance ticket" and
;; "attributed to a different ticket" are common, not vanishingly rare -
;; the recorded generator-weighting lesson (a uniform draw over a wide
;; alphabet makes the interesting collision case rare while looking green).
(def tickets ["BL-654" "BL-660" "BL-700"])

;; ── P1: attribution-soundness ──────────────────────────────────────────────
;; Independent oracle: literally the ticket's own prose rule ("HELD when the
;; attributed-ticket set is non-empty and does not contain the ambulance
;; ticket; otherwise it moves"), built without reusing parcel-held?'s code.

(defn gen-mentions [s]
  (let [[n s1] (gen-int s 3)]
    (reduce (fn [[acc sx] _]
              (let [[t sy] (gen-pick sx tickets)] [(conj acc t) sy]))
            [[] s1] (range n))))

;; A git_handoff's task: header carries exactly ONE ticket id (or is absent) -
;; unlike message:/body, which are free text that can mention several.
(defn gen-task [s]
  (let [[present? s1] (gen-bool s)]
    (if-not present?
      [nil s1]
      (let [[t s2] (gen-pick s1 tickets)] [t s2]))))

(defn gen-envelope-and-ambulance [s]
  (let [[active? s1] (gen-bool s)
        [ambulance-ticket s2] (gen-pick s1 tickets)
        [task s3] (gen-task s2)
        [in-msg s4] (gen-mentions s3)
        [in-body s5] (gen-mentions s4)]
    [{:ambulance {:active active? :ticket ambulance-ticket}
      :envelope {:headers {"task" task
                           "message" (when (seq in-msg) (clojure.string/join " " in-msg))}
                :body (clojure.string/join " " in-body)}
      :all-mentions (set (concat (when task [task]) in-msg in-body))}
     s5]))

(check-all "P1 attribution-soundness: parcel-held? matches the independent oracle" gen-envelope-and-ambulance
  (fn [{:keys [ambulance envelope all-mentions]}]
    (let [held (ambulance-lib/parcel-held? ambulance envelope)
          expected (boolean (and (:active ambulance)
                                  (seq all-mentions)
                                  (not (contains? all-mentions (:ticket ambulance)))))]
      (if (= held expected)
        true
        (str "held=" held " expected=" expected " ambulance=" (pr-str ambulance) " mentions=" (pr-str all-mentions))))))

;; ── P2: engage!/release! idempotence + order-independence ──────────────────
;; Repeating the SAME op (engage of one fixed ticket, or release) any number
;; of times from ANY starting marker state converges after the first
;; application and stays byte-identical for every repeat after that -
;; independent of how many times it's repeated (the "order-independent"
;; half: every repeat position produces the identical result).

(defn gen-repeat-scenario [s]
  (let [[op s1] (gen-pick s [:engage :release])
        [start s2] (gen-pick s1 [:none :engaged-654 :engaged-660 :inactive])
        [repeats s3] (gen-int s2 4)] ; 0..3 -> 1..4 total applications
    [{:op op :start start :repeats (inc repeats)} s3]))

(defn seed-start! [root start]
  (case start
    :none nil
    :engaged-654 (ambulance-lib/engage! root "BL-654" "seed")
    :engaged-660 (ambulance-lib/engage! root "BL-660" "seed")
    :inactive (ambulance-lib/release! root)))

(defn marker-content-or-absent
  "A release! from :none leaves the marker file genuinely absent (no
   rewrite) - slurp would throw. :absent is a real, comparable value here,
   distinct from any string content, so byte-identity checks still work."
  [root]
  (if (fs/exists? (ambulance-lib/marker-path root))
    (slurp (str (ambulance-lib/marker-path root)))
    :absent))

(check-all "P2 engage!/release! idempotent and order-independent under repetition" gen-repeat-scenario
  (fn [{:keys [op start repeats]}]
    (let [root (mk-tmp)]
      (write-ticket! root "BL-654")
      (seed-start! root start)
      (let [apply-op! (fn [] (if (= op :engage) (ambulance-lib/engage! root "BL-654" "cli") (ambulance-lib/release! root)))
            _ (apply-op!)
            after-first (marker-content-or-absent root)
            mismatches (for [_ (range (dec repeats))
                             :let [_ (apply-op!)
                                   content (marker-content-or-absent root)]
                             :when (not= after-first content)]
                         content)]
        (if (empty? mismatches)
          true
          (str "repeat diverged from first application: " (pr-str mismatches)))))))

;; ── P3: freshness - no cached mode state survives a marker change ──────────
;; expected-i is a function of op-i ALONE (never of history), so any
;; memoization/staleness bug shows up the moment two consecutive ops in the
;; sequence differ.

(def ops [:engage-654 :engage-660-no-file :release])

(defn gen-op-sequence [s]
  (let [[n s1] (gen-int s 5)] ; 1..5 ops
    (reduce (fn [[acc sx] _]
              (let [[op sy] (gen-pick sx ops)] [(conj acc op) sy]))
            [[] s1] (range (inc n)))))

(defn expected-for-op [op]
  (case op
    :engage-654 {:active true :ticket "BL-654"}
    ;; BL-660 is deliberately never given a backlog file in this root - the
    ;; ticket-has-file? deadlock guard must fail this read to inactive, and a
    ;; freshness bug would instead leak whatever the PRIOR op's state was.
    :engage-660-no-file {:active false}
    :release {:active false}))

(defn apply-op! [root op]
  (case op
    :engage-654 (ambulance-lib/engage! root "BL-654" "cli")
    :engage-660-no-file (ambulance-lib/engage! root "BL-660" "cli")
    :release (ambulance-lib/release! root)))

(check-all "P3 freshness: every read reflects only the immediately-preceding write" gen-op-sequence
  (fn [op-seq]
    (let [root (mk-tmp)]
      (write-ticket! root "BL-654")
      (let [mismatches (for [op op-seq
                             :let [_ (apply-op! root op)
                                   actual (ambulance-lib/read-ambulance-state root)
                                   expected (expected-for-op op)]
                             :when (not= actual expected)]
                         {:op op :expected expected :actual actual})]
        (if (empty? mismatches)
          true
          (str "stale read(s) found: " (pr-str mismatches)))))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "ambulance_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
