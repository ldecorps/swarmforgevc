#!/usr/bin/env bb
;; BL-1240's two declared invariants, coder-authored (BL-654), as PROPERTY
;; tests over unregistered_test_gate_lib.bb and the inventory check it reuses.
;;
;; Deterministic by construction: a seeded LCG, never rand.
;;
;; GENERATOR REACH. The interesting states are rare under any uniform draw
;; over "some paths", so each is CONSTRUCTED rather than hoped for: every
;; parcel is built from an explicit shape - it adds an unregistered test file,
;; a registered one, a deleted one, or no test file at all while the tree
;; carries someone else's unregistered ones. Each shape is drawn as a case,
;; and each case has its own floor, so a shape cannot silently stop being
;; generated. The alternative - drawing paths independently and hoping a
;; parcel happens to add exactly an unregistered test file - is the lottery
;; that made BL-1235's floor a 1-in-8 coin toss.
;;
;; Non-vacuity is proven by breaking each invariant and recording the result -
;; see backlog/evidence/BL-1240-unregistered-test-gate-20260830.md.

(ns bl1240-unregistered-test-gate-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "unregistered_test_gate_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {}))
(defn- cover! [k] (swap! coverage update k (fnil inc 0)))

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
        (when-not (true? result) (report! prop s input (str result)))
        (recur (inc i) s')))))

(def T unregistered-test-gate-lib/test-dir)

;; Both shapes the tree uses, and three that look like tests but are not - so
;; the boundary suite-inventory-lib/test-file? draws is actually crossed.
(def test-names ["test_alpha.sh" "test_beta.sh" "gamma_test_runner.bb" "delta_test_runner.bb"])
(def non-test-names ["suite_inventory_lib.bb" "bl999_x_property_runner.bb" "helper.sh" "fixture.tsv"])
(def foreign-paths ["extension/src/tools/a.ts" "docs/how-to/BL-1240-x.md"
                    "swarmforge/scripts/handoffd.bb" "backlog/active/BL-1240-x.yaml"])
(def lanes [{:lane "standing" :date "" :reason ""}
            {:lane "excluded" :date "2026-08-30" :reason "live-only"}])

;; ── the generator: four constructed parcel shapes ────────────────────────
;;
;; :unregistered  adds a test file with no row
;; :registered    adds a test file that has one (either lane)
;; :deleted       "adds" a test file with no row that no longer exists
;; :clean         adds no test file at all, while OTHER files sit unregistered

(defn gen-case [s]
  (let [[shape s0] (gen-pick s [:unregistered :registered :deleted :clean])
        [subject s1] (gen-pick s0 test-names)
        [lane s2] (gen-pick s1 lanes)
        [noise s3] (gen-pick s2 foreign-paths)
        [non-test s4] (gen-pick s3 non-test-names)
        ;; Someone else's omission, always present in the tree: scenario 03's
        ;; whole point is that it must never affect this parcel's verdict.
        others (remove #{subject} test-names)
        changed (cond-> [noise (str T "/" non-test)]
                  (not= shape :clean) (conj (str T "/" subject)))
        rows (cond-> []
               (= shape :registered) (conj (merge {:file subject} lane)))]
    [{:shape shape :subject subject :changed changed :rows rows
      :exists? (if (= shape :deleted) #{} (set changed))
      :others others}
     s4]))

(defn- findings-for [{:keys [changed rows exists?]}]
  (unregistered-test-gate-lib/unregistered-findings
   {:changed-paths changed :manifest-rows rows :exists? #(contains? exists? %)}))

;; ── invariant 1 ───────────────────────────────────────────────────────────
;; "A parcel that adds a test file without a manifest row does not move to the
;;  next stage."
;;
;; Stated as an EQUIVALENCE so both directions are checked every draw: a gate
;; that blocked everything would satisfy the refusal half and stop the
;; pipeline; one that blocked nothing would satisfy neither. The three
;; not-blocked shapes are exactly the three ways a parcel is innocent, and
;; :clean is scenario 03 - unregistered files belonging to OTHER parcels sit
;; in the tree on every single draw.

(check-all
 "P1: the forward is refused exactly when THIS parcel adds an unregistered, present test file"
 gen-case
 (fn [{:keys [shape subject] :as input}]
   (cover! shape)
   (let [result {:findings (findings-for input)}
         blocked (unregistered-test-gate-lib/blocked? result)
         should-block (= shape :unregistered)]
     (cond
       (and should-block (not blocked))
       "a parcel adding an unregistered test file was allowed to move on"
       (and (not should-block) blocked)
       (str "an innocent parcel (" (name shape) ") was refused: "
            (pr-str (mapv :file (:findings result))))
       ;; ...and when it does refuse, it refuses about the right file.
       (and blocked (not= [subject] (mapv :file (:findings result))))
       (str "the refusal named " (pr-str (mapv :file (:findings result))) ", not " subject)
       :else true))))

;; ── invariant 1, second half: it names the file and the row ──────────────
;;
;; A refusal the author cannot act on in one edit is the same cost as the
;; refusal landing on QA, only earlier - so "does not move to the next stage"
;; is only satisfied when the message says what to do about it.

(check-all
 "P1b: every refusal names the file, the manifest, and a row that would register it"
 gen-case
 (fn [{:keys [subject] :as input}]
   (let [findings (findings-for input)]
     (if (empty? findings)
       true
       (let [msg (unregistered-test-gate-lib/refusal-message
                  {:task-name "BL-1240-unregistered-test" :findings findings})
             quoted (->> (str/split-lines msg)
                         (filter #(str/starts-with? % subject))
                         first)]
         (cond
           (not (str/includes? msg subject)) "the refusal does not name the file"
           (not (str/includes? msg suite-inventory-lib/manifest-name))
           "the refusal does not name the manifest"
           (nil? quoted) "the refusal quotes no row for the file"
           ;; The quoted row must actually be a row that registers it - a
           ;; suggestion that would not satisfy the check is worse than none.
           (not (empty? (unregistered-test-gate-lib/unregistered-findings
                         {:changed-paths (:changed input)
                          :manifest-rows (suite-inventory-lib/parse-manifest quoted)
                          :exists? #(contains? (:exists? input) %)})))
           (str "the row the refusal offers does not register the file: " (pr-str quoted))
           :else true))))))

;; ── invariant 2 ───────────────────────────────────────────────────────────
;; "A manifest row that registers no existing file is reported as an error,
;;  never accepted silently."
;;
;; Asked of suite_inventory_lib.bb, the code the CLI runs, because there must
;; be exactly one notion of what a row registers. Two shapes of empty row are
;; constructed and each floored: a first column that is not a test file name
;; at all (the BL-1239 shape - `test_bl780_...sh` written as a ticket id), and
;; one that names a test file which is not in the tree.

(def bogus-first-columns ["BL-780" "bl1240_x_property_runner.bb" "suite_inventory_lib.bb" ""])

(defn gen-row-case [s]
  (let [[kind s0] (gen-pick s [:not-a-test-name :absent-file :real])
        [bogus s1] (gen-pick s0 bogus-first-columns)
        [present s2] (gen-pick s1 test-names)
        [absent s3] (gen-pick s2 (remove #{present} test-names))
        [lane s4] (gen-pick s3 lanes)
        subject (case kind :not-a-test-name bogus :absent-file absent :real present)]
    [{:kind kind :subject subject
      :discovered #{present}
      ;; The real, present file always has its row; the case under test adds
      ;; the second one - except in :real, where the two are the same row and
      ;; a duplicate would be a different error than the one being asked
      ;; about.
      :rows (cond-> [(merge {:file present} (first lanes))]
              (not= subject present) (conj (merge {:file subject} lane)))}
     s4]))

(check-all
 "P2: a row registering no existing file is always an error naming that row"
 gen-row-case
 (fn [{:keys [kind subject discovered rows]}]
   (cover! (keyword (str "row-" (name kind))))
   (let [problems (suite-inventory-lib/check discovered rows)
         names-it? (some #(str/includes? % (pr-str subject)) problems)
         mentions-it? (some #(str/includes? % subject) problems)]
     (cond
       (= kind :real)
       (if (seq problems)
         (str "a row registering a real, present file was reported: " (pr-str problems))
         true)
       (empty? problems)
       "a row that registers nothing was accepted silently"
       ;; Naming the row is the requirement, not merely failing: a validation
       ;; that said "the manifest is wrong" costs the reader the same search.
       (not (or names-it? mentions-it?))
       (str "the error does not name the row " (pr-str subject) ": " (pr-str problems))
       :else true))))

(def floors {:unregistered 60 :registered 60 :deleted 60 :clean 60
             :row-not-a-test-name 100 :row-absent-file 100 :row-real 100})

(doseq [[k floor] (sort floors)]
  (let [drawn (get @coverage k 0)]
    (when (< drawn floor)
      (swap! failures conj (str "FAIL reach floor: " (name k) " drawn " drawn " < " floor)))))

(if (empty? @failures)
  (println (str "ALL PASS (" runs " runs each, coverage " (pr-str (into (sorted-map) @coverage)) ")"))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
