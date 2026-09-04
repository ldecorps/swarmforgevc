#!/usr/bin/env bb
;; BL-1377: PROPERTY tests over the two invariants the ticket YAML declares
;; (coder-authored first, per BL-654).
;;
;;   P1 the-cache-shrinks-a-run-never-widens-an-excuse - for every record and
;;      every observed set, a red is excused only if the record NAMES it, at
;;      the same base sha and the same config hash, and only if it was actually
;;      observed. Every red not in the record is named `new`, and the evidence
;;      text never calls it pre-existing.
;;   P2 no-usable-record-is-ever-a-green - absent, unreadable and every shape
;;      of key mismatch produce a second run with nothing excused and nothing
;;      claimed new. A missing baseline can never become a pass.
;;
;; Toolchain: the .bb property-runner precedent (expedite_lib_property_runner.bb,
;; ambulance_lib_property_runner.bb); BL-472 defers real property tooling for
;; Babashka, and BL-654's *.property.test.js home is the TypeScript lane.
;;
;; GENERATOR REACH is asserted, not hoped for. A record-vs-observed pair drawn
;; INDEPENDENTLY would almost never agree, so the interesting cases - exact
;; match, one added, one removed - would be vanishingly rare and P1 would pass
;; forever on mismatches alone. The observed set is therefore DERIVED from the
;; record by the transformation each case needs, and the run fails unless every
;; case and every record shape was actually generated.

(ns bl1377-suite-baseline-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "suite_baseline_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))
(def reached (atom #{}))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- red [i] (str "test/t" i ".test.js > case " i))

(defn- gen-reds [s]
  (let [[n s'] (gen-int s 6)]
    [(vec (map red (range n))) s']))

(def record-shapes [:match :absent :unreadable :other-sha :other-hash :other-suite])
(def observed-shapes [:same :added :removed :added-and-removed :empty])

(def key0 {:suite "unit" :base-sha "abc1230000" :config-hash "cfg-1"})

(loop [i 0 s 913770]
  (when (< i runs)
    (let [[recorded s1] (gen-reds s)
          [rshape s2] (gen-pick s1 record-shapes)
          [oshape s3] (gen-pick s2 observed-shapes)
          ;; DERIVED, never drawn independently: every observed set is the
          ;; recorded one put through the transformation this case is about,
          ;; so "exactly equal" and "differs by one" are reached by
          ;; construction rather than by luck.
          observed (case oshape
                     :same (vec (shuffle recorded))
                     :added (conj (vec recorded) (red 99))
                     :removed (vec (butlast recorded))
                     :added-and-removed (conj (vec (butlast recorded)) (red 98))
                     :empty [])
          record (case rshape
                   :match {:key key0 :reds recorded}
                   :absent nil
                   :unreadable nil
                   :other-sha {:key (assoc key0 :base-sha "def4560000") :reds recorded}
                   :other-hash {:key (assoc key0 :config-hash "cfg-2") :reds recorded}
                   :other-suite {:key (assoc key0 :suite "properties") :reds recorded})
          d (suite-baseline-lib/decide {:key key0
                                        :record record
                                        :record-error (when (= rshape :unreadable) "not JSON")
                                        :observed observed})
          text (suite-baseline-lib/evidence-line d)
          input {:rshape rshape :oshape oshape :recorded recorded :observed observed}]
      (swap! reached conj [rshape oshape])

      ;; ── P1 ────────────────────────────────────────────────────────────
      (doseq [e (:excused d)]
        (when-not (and (= rshape :match) (some #{e} recorded) (some #{e} observed))
          (report! "P1" s input (str "excused a red the record does not name and observe: " (pr-str e)))))
      (when (= rshape :match)
        (let [expected-new (vec (remove (set recorded) observed))
              expected-gone (vec (remove (set observed) recorded))]
          (when-not (= (set expected-new) (set (:new d)))
            (report! "P1" s input (str "the new set is wrong: " (pr-str (:new d)))))
          (when-not (= (set expected-gone) (set (:vanished d)))
            (report! "P1" s input (str "the vanished set is wrong: " (pr-str (:vanished d)))))
          (when (and (seq expected-new) (not (:second-run? d)))
            (report! "P1" s input "a new red did not force the second run"))
          (when (and (seq expected-gone) (not (:second-run? d)))
            (report! "P1" s input "a vanished red did not force the second run"))
          (doseq [n (:new d)]
            (when-not (str/includes? text n)
              (report! "P1" s input (str "a new red never reached the evidence: " (pr-str n))))
            (when (str/includes? text "same set")
              (report! "P1" s input "the evidence claims the sets agree while naming a new red")))))

      ;; ── P2 ────────────────────────────────────────────────────────────
      (when (not= rshape :match)
        (when-not (:second-run? d)
          (report! "P2" s input "an unusable record skipped the base run"))
        (when (seq (:excused d))
          (report! "P2" s input (str "an unusable record excused: " (pr-str (:excused d)))))
        (when (seq (:new d))
          (report! "P2" s input "an unusable record was used to call a red new"))
        (when-not (:write-baseline? d)
          (report! "P2" s input "an unusable record left no baseline to write"))
        (when (str/includes? text "same set")
          (report! "P2" s input (str "an unusable record produced a matching-set claim:\n" text)))
        (when-not (seq (:reason d))
          (report! "P2" s input "an unusable record gave no reason")))

      ;; True either way: a decision always says which suite and which base it
      ;; is about, because a pre-existing red is only pre-existing at a base.
      (when-not (and (str/includes? text (:suite key0)) (str/includes? text (:base-sha key0)))
        (report! "P1" s input (str "the evidence names no suite/base: " text)))

      (recur (inc i) s3))))

(doseq [r record-shapes]
  (when-not (some #(= r (first %)) @reached)
    (swap! failures conj (str "FAIL generator reach: record shape " r " was never generated."))))
(doseq [o observed-shapes]
  (when-not (some #(= o (second %)) @reached)
    (swap! failures conj (str "FAIL generator reach: observed shape " o " was never generated."))))
;; The one that matters most: a match whose sets are exactly equal, which is
;; the only case that can skip a run at all.
(when-not (contains? @reached [:match :same])
  (swap! failures conj "FAIL generator reach: the exact-match case, the only one that skips a run, was never generated."))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println (str "bl1377 suite baseline: ALL PROPERTIES HOLD (" runs " runs)")))
