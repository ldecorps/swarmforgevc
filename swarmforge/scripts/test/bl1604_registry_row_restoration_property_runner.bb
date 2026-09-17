#!/usr/bin/env bb
;; BL-1604 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests over land_step_lib.bb's rows-to-restore,
;; encoding both declared invariants.
;;
;;   invariant 1 - "A land never reduces another open ticket's ownership:
;;      for every row of either registry file on origin/main whose owner
;;      is open and not the landing ticket, the same row is on origin/main
;;      after the land": rows-to-restore agrees with a brute-force,
;;      independently-written filter (owner open AND owner != landing AND
;;      the row's key missing from the replay tree's own keys) across
;;      random origin-line sets, a random owner pool and a random
;;      replay-keys subset drawn independently of row construction order.
;;
;;   invariant 2 - "The landing ticket's own rows are never protected from
;;      itself: a row it owns and removed at its tip is absent after the
;;      land, exactly as before this change": asserted DIRECTLY inside the
;;      same generative loop (never left to the aggregate equality check
;;      above to catch by accident) - a landing-owned row missing from
;;      replay-keys must never appear in rows-to-restore's result.
;;
;; Same seeded RNG convention as this directory's other property runners
;; (see bl1576_merge_drop_guard_property_runner.bb) - no shared framework,
;; each runner owns its own loop.
;;
;; Non-vacuity proven by hand at authoring time: relaxing the `(not=
;; owner task-ticket-id)` clause in rows-to-restore to always-true fails
;; invariant 2's direct assertion on its first reached case; relaxing the
;; `(contains? open-ticket-ids owner)` clause to always-true fails
;; invariant 1's equivalence check on its first closed-owner case. Both
;; restored before landing.

(ns bl1604-registry-row-restoration-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 2000))
(def failures (atom []))
(def ^:private rng (java.util.Random. 1604))
(defn- rint [n] (.nextInt rng (int n)))
(defn- rbool [] (.nextBoolean rng))
(defn- rpick [coll] (nth (vec coll) (rint (count coll))))

;; ── shared fixture shape: standing-reds.tsv rows ────────────────────────

(def landing-id "BL-9001")
(def other-open-ids #{"BL-9002" "BL-9003" "BL-9004"})
(def closed-ids #{"BL-9010" "BL-9011"})
(def owner-pool (vec (concat other-open-ids closed-ids [landing-id])))
;; The landing ticket is itself open on origin/main - its own backlog/active
;; file sits there until the coordinator's post-QA bookkeeping closes it -
;; so open-ticket-ids-for would report it open too. Folding it into
;; open-ids here (never testing it as "closed") is what makes the
;; `(not= owner task-ticket-id)` clause in rows-to-restore the ONLY thing
;; protecting invariant 2: a fixture that kept the landing ticket out of
;; the open set would let a broken implementation missing that clause pass
;; undetected, since `(contains? open-ticket-ids owner)` would already
;; exclude it for the wrong reason.
(def open-ids (conj other-open-ids landing-id))

(defn- rline [i]
  (let [owner (rpick owner-pool)]
    {:key (str "file-" i ".test.js")
     :owner owner
     :line (str "unit\tfile-" i ".test.js\t" owner "\t2026-09-01\tnote-" i)}))

(defn- row-key-fn [line] (nth (str/split line #"\t" -1) 1 nil))
(defn- owner-fn [line] (nth (str/split line #"\t" -1) 2 nil))

(defn- expected-restore
  "Independent brute-force reimplementation - never calls rows-to-restore,
   so the property is not just re-stating the function under test."
  [{:keys [rows replay-keys task-ticket-id open-ticket-ids]}]
  (vec (for [{:keys [key owner line]} rows
             :when (and (contains? open-ticket-ids owner)
                        (not= owner task-ticket-id)
                        (not (contains? replay-keys key)))]
         line)))

;; ── reachability floors (asserted, never assumed) ───────────────────────
(def open-other-missing-reached (atom 0))
(def landing-own-missing-reached (atom 0))

(dotimes [_ runs]
  (let [n (inc (rint 8))
        rows (mapv rline (range n))
        ;; independent random subset of "already on the replay tree" keys -
        ;; drawn per-row, not correlated with owner or construction order,
        ;; so both "present on replay" and "missing from replay" are
        ;; reached for every owner class.
        replay-keys (set (keep (fn [{:keys [key]}] (when (rbool) key)) rows))
        expected (expected-restore {:rows rows :replay-keys replay-keys
                                     :task-ticket-id landing-id :open-ticket-ids open-ids})
        actual (land-step-lib/rows-to-restore
                {:origin-lines (mapv :line rows) :replay-keys replay-keys
                 :row-key-fn row-key-fn :owner-fn owner-fn
                 :task-ticket-id landing-id :open-ticket-ids open-ids})]
    (when (some #(and (contains? open-ids (:owner %)) (not (contains? replay-keys (:key %)))) rows)
      (swap! open-other-missing-reached inc))
    (when (some #(and (= landing-id (:owner %)) (not (contains? replay-keys (:key %)))) rows)
      (swap! landing-own-missing-reached inc))

    (when (not= expected actual)
      (swap! failures conj (str "FAIL invariant 1: expected " (pr-str expected) " got " (pr-str actual)
                                 " for rows " (pr-str rows) " replay-keys " (pr-str replay-keys))))

    ;; invariant 2, asserted directly against this same draw.
    (doseq [{:keys [key owner line]} rows
            :when (and (= owner landing-id) (not (contains? replay-keys key)))]
      (when (some #{line} actual)
        (swap! failures conj (str "FAIL invariant 2: the landing ticket's own missing row was restored: " line))))))

(when (zero? @open-other-missing-reached)
  (swap! failures conj "FAIL reachability: no open-other-owned row missing from replay-keys was ever generated (invariant 1 untested)"))
(when (zero? @landing-own-missing-reached)
  (swap! failures conj "FAIL reachability: no landing-owned row missing from replay-keys was ever generated (invariant 2 untested)"))

;; The incident's own shape, asserted directly (never left to chance in
;; the generative loop above): 2c1c44e2cc dropped BL-9595's row - modeled
;; here as BL-9002's, an open ticket other than the landing one, missing
;; from the replay tree - and it must come back.
(let [row "unit\tfile-x.test.js\tBL-9002\t2026-09-01\tnote-x"]
  (when (not= [row]
              (land-step-lib/rows-to-restore
               {:origin-lines [row] :replay-keys #{} :row-key-fn row-key-fn :owner-fn owner-fn
                :task-ticket-id landing-id :open-ticket-ids open-ids}))
    (swap! failures conj "FAIL invariant 1: 2c1c44e2cc's own incident shape (an open other ticket's row) was not restored")))

;; The drain rule's own shape, asserted directly: the landing ticket's own
;; row, missing from the replay tree because ITS OWN tip removed it, must
;; stay gone.
(let [row (str "unit\tfile-w.test.js\t" landing-id "\t2026-09-01\tnote-w")]
  (when (seq (land-step-lib/rows-to-restore
              {:origin-lines [row] :replay-keys #{} :row-key-fn row-key-fn :owner-fn owner-fn
               :task-ticket-id landing-id :open-ticket-ids open-ids}))
    (swap! failures conj "FAIL invariant 2: the drain rule's own shape (the landing ticket's own removed row) was restored")))

(println (str "rows-to-restore property: " runs " runs"))
(if (seq @failures)
  (do (doseq [f (take 10 @failures)] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
