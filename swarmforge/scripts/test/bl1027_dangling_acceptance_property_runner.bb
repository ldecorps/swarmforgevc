#!/usr/bin/env bb
;; BL-1027: mint-time dangling-acceptance properties.
;; Invariant 1: checkability is exactly acceptance-pointer-gate-lib/applicable?
;; Invariant 2: absent acceptance is never refused by this check.

(ns bl1027-dangling-acceptance-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "backlog_hygiene_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "acceptance_pointer_gate_lib.bb")))

(def repo-root
  (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*))))))
)

(defn assert! [msg ok]
  (when-not ok
    (println (str "FAIL: " msg))
    (System/exit 1)))

(defn ticket [acceptance-line]
  (str "id: BL-1027\ntitle: t\ntype: feature\nepic: e\nmilestone: M8\n"
       (when acceptance-line (str acceptance-line "\n"))
       "priority: 5\n"))

(defn dangling? [text]
  (some #(= :dangling-acceptance (:kind %))
        (backlog-hygiene-lib/violations-for-text text
                                                 {:id "BL-1027" :path "fixture.yaml"
                                                  :repo-root repo-root})))

;; Invariant 2: no acceptance: line → never dangling.
(assert! "absent acceptance is never dangling"
         (not (dangling? (ticket nil))))

;; Invariant 1: when applicable? is false, never dangling (block-scalar residue).
(assert! "block-scalar residue is never dangling"
         (not (dangling? (ticket "acceptance: |"))))

;; When applicable? is true and the path is missing → dangling.
(let [missing "specs/features/BL-1027-property-missing.feature"
      text (ticket (str "acceptance: " missing))]
  (assert! "applicable missing path is dangling"
           (and (acceptance-pointer-gate-lib/applicable? missing)
                (dangling? text))))

;; When applicable? is true and the path exists → not dangling.
(let [present "specs/features/BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer.feature"
      text (ticket (str "acceptance: " present))]
  (assert! "applicable present path is not dangling"
           (and (acceptance-pointer-gate-lib/applicable? present)
                (not (dangling? text)))))

;; Grep posture: hygiene lib must call applicable?, not redefine it.
(let [src (slurp (str (fs/path repo-root "swarmforge" "scripts" "backlog_hygiene_lib.bb")))]
  (assert! "hygiene lib consults acceptance-pointer-gate-lib/applicable?"
           (str/includes? src "acceptance-pointer-gate-lib/applicable?"))
  (assert! "hygiene lib does not define its own applicable?"
           (not (re-find #"(?m)^\(defn applicable\?" src))))

(println "bl1027_dangling_acceptance_property_runner: all passed")
