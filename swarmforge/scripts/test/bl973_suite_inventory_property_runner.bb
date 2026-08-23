#!/usr/bin/env bb
;; BL-973 property test (coder-authored, DECLARED invariant 2), over the
;; suite-completeness gate.
;;
;;   Invariant 2: "Every test file under swarmforge/scripts/test/ is run by a
;;   standing gate or carries an explicit dated exclusion with a reason - a red
;;   test cannot sit unrun and unnoticed."
;;
;; Lane note: a bb property runner rather than a *.property.test.js, following
;; the repo's shape for invariants whose subject is Babashka source (bl1035,
;; bl1043, bl1076). Still outside the unit lane, still run only on purpose.
;;
;; The invariant is an ACCOUNTING claim, so the properties are stated as an
;; equivalence rather than as a list of rejections:
;;
;; P1 - the gate passes IF AND ONLY IF every discovered test file sits in
;;      exactly one lane, and every excluded row carries both a date and a
;;      reason. Stated both ways on purpose: "it rejects bad manifests" alone
;;      is satisfied by a gate that rejects everything, and "it accepts good
;;      ones" alone by a gate that accepts everything.
;;
;; P2 - whatever the gate rejects, it NAMES. A gate that failed without saying
;;      which file would leave the reader exactly where the defect left three
;;      roles: knowing something is wrong and having to sweep for it.
;;
;; P3 - an exclusion is a dated decision, never a permanent silence. A row with
;;      no date, a malformed date, or no reason is rejected even though it is
;;      syntactically in a lane. This is the clause that stops the gate from
;;      being satisfiable by excluding everything, which would reproduce the
;;      original condition exactly while showing green.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-23), each break restored,
;; counts MEASURED (seed 1973, 200 runs):
;;   - accept any lane string ........................... P1 17
;;   - stop requiring a date on an exclusion ............ P1 11, P3 66
;;   - stop requiring a reason on an exclusion .......... P1 17, P3 91
;;   - report problems without naming the file .......... P2 51
;;   - ignore files the manifest never lists ............ P1 19
;; Every number is the measured count, not an estimate.
;;
;; P3 fires far more often than P1 on the two exclusion breaks, and that is the
;; argument for P3 existing. P1 only notices when the manifest is otherwise
;; sound, so it catches the undated exclusion in the minority of runs where
;; nothing else is also wrong. P3 objects per row, every time - which is what a
;; gate satisfiable by excluding everything needs held against it.

(ns bl973-suite-inventory-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "suite_inventory_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))
(def coverage (atom {:all-good 0 :unlisted 0 :orphan-row 0 :bad-lane 0
                     :undated 0 :unreasoned 0 :duplicate 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; An independent judgement of the same rule, so the property is not the code
;; checking itself: a manifest is sound exactly when the listed files are the
;; discovered files, no file is listed twice, every lane is known, and every
;; exclusion carries a real date and a non-blank reason.
(defn- sound? [discovered rows]
  (let [listed (map :file rows)]
    (and (= (set listed) discovered)
         (= (count listed) (count (set listed)))
         (every? #{"standing" "excluded"} (map :lane rows))
         (every? (fn [{:keys [lane date reason]}]
                   (or (not= "excluded" lane)
                       (and (re-matches #"^\d{4}-\d{2}-\d{2}$" (str date))
                            (not (str/blank? (str reason))))))
                 rows))))

(loop [i 0 s 1973]
  (when (< i runs)
    (let [[n-extra s1] (gen-int s 5)
          n-files (+ 1 n-extra)
          names (vec (for [k (range n-files)] (str "test_" i "_" k ".sh")))
          discovered (set names)
          ;; Each file's row is DERIVED from a per-file defect draw rather than
          ;; assembled at random, so every rejection shape is reachable by
          ;; construction - drawing lanes and dates independently produces a
          ;; sound manifest almost never, and an undated exclusion rarely.
          [rows s2]
          (loop [k 0 acc [] st s1]
            (if (>= k n-files)
              [acc st]
              (let [[shape st1] (gen-int st 6)
                    nm (nth names k)
                    row (case shape
                          0 {:file nm :lane "standing" :date "" :reason ""}
                          1 {:file nm :lane "standing" :date "" :reason ""}
                          2 {:file nm :lane "excluded" :date "2026-08-23" :reason "live-only: drives real tmux"}
                          3 {:file nm :lane "excluded" :date "" :reason "slow"}
                          4 {:file nm :lane "excluded" :date "2026-08-23" :reason ""}
                          5 {:file nm :lane "skipped" :date "" :reason ""})]
                (when (= 3 shape) (swap! coverage update :undated inc))
                (when (= 4 shape) (swap! coverage update :unreasoned inc))
                (when (= 5 shape) (swap! coverage update :bad-lane inc))
                (recur (inc k) (conj acc row) st1))))
          ;; Sometimes a file nobody listed - the shape that let three tests sit
          ;; unrun - and sometimes a row for a file that is gone.
          [drop-pick s3] (gen-int s2 4)
          [orphan-pick s4] (gen-int s3 4)
          [dup-pick s5] (gen-int s4 6)
          rows (cond-> rows
                 (zero? drop-pick) (->> (drop 1) vec)
                 (zero? orphan-pick) (conj {:file (str "test_" i "_gone.sh") :lane "standing" :date "" :reason ""})
                 (and (zero? dup-pick) (seq rows)) (conj (first rows)))
          problems (suite-inventory-lib/check discovered rows)
          ok? (empty? problems)
          expected-ok? (sound? discovered rows)
          input {:discovered (sort discovered) :rows rows}]

      (when (zero? drop-pick) (swap! coverage update :unlisted inc))
      (when (zero? orphan-pick) (swap! coverage update :orphan-row inc))
      (when (and (zero? dup-pick) (seq rows)) (swap! coverage update :duplicate inc))
      (when expected-ok? (swap! coverage update :all-good inc))

      ;; ── P1 (invariant 2): pass IFF fully and validly accounted for.
      (when (and expected-ok? (not ok?))
        (report! "P1 (invariant 2: a fully accounted-for tree passes)" s input
                 (str "rejected a sound manifest: " (pr-str problems))))
      (when (and (not expected-ok?) ok?)
        (report! "P1 (invariant 2: an unaccounted-for tree never passes)" s input
                 "accepted a manifest that does not account for the tree"))

      ;; ── P2: every problem names the file it is about. Without this a red
      ;; gate leaves the reader sweeping, which is the cost this ticket exists
      ;; to remove.
      (doseq [p problems]
        (when-not (some (fn [n] (str/includes? p n))
                        (concat names (map :file rows)))
          (report! "P2 (invariant 2: a problem always names its file)" s input
                   (str "unattributable problem: " p))))

      ;; ── P3: an exclusion is a DATED decision with a reason, never a
      ;; permanent silence. Otherwise the gate is satisfiable by excluding
      ;; everything - green, and the original condition restored exactly.
      (doseq [{:keys [file lane date reason]} rows]
        (when (= "excluded" lane)
          (let [bad-date? (not (re-matches #"^\d{4}-\d{2}-\d{2}$" (str date)))
                bad-reason? (str/blank? (str reason))]
            (when (and (or bad-date? bad-reason?)
                       (not (some #(str/includes? % file) problems)))
              (report! "P3 (invariant 2: an exclusion needs a date and a reason)" s input
                       (str file " is excluded with date " (pr-str date)
                            " and reason " (pr-str reason) " and was not objected to"))))))

      (recur (inc i) s5))))

(doseq [[k floor] {:all-good 15 :unlisted 30 :orphan-row 30 :bad-lane 30
                   :undated 30 :unreasoned 30 :duplicate 20}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl973 suite-inventory properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
