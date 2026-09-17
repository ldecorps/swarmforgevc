#!/usr/bin/env bb
;; BL-1611: PROPERTY test over handoff_lib.bb's handoff-files-with-batches,
;; covering the ticket YAML's one declared invariant (coder-authored first,
;; per BL-654):
;;
;;   "For every roster shape, the drift guard's in-process input is true
;;    exactly when a git_handoff or note parcel exists anywhere under the
;;    role's in_process box, at the top level or inside a batch_
;;    directory."
;;
;; ready_for_next.bb's has-in-process-parcel? IS
;;   (boolean (seq (handoff-files-with-batches dir)))
;; - loading ready_for_next.bb itself as a library is not an option (its
;; top-level forms run the real pre-turn guards, including a System/exit,
;; against whatever git-root this process happens to resolve against), so
;; this property pins the existence semantics directly against the REAL
;; committed reader the guard wires to (BL-1313), over randomly generated
;; in_process box trees materialized under a real mkdtemp - the reader does
;; real filesystem IO, so no in-memory fixture can stand in dishonestly for
;; a filesystem-shaped question.
;;
;; Seeded (not wall-clock) randomness so failures reproduce.
;;
;;   P1 existence-matches-generated-truth - the reader's "something is
;;      held" boolean equals whether the generated tree actually placed a
;;      .handoff file somewhere the invariant says it must be seen (top
;;      level or inside a batch_ directory) - regardless of how many
;;      batch_ directories exist, how many of them are empty, or how much
;;      non-.handoff noise (other files/dirs) sits alongside them.
;;
;; BL-654 generator-reach: sweeps top-level .handoff-file count (0..2),
;; batch_ directory count (0..3) and per-batch-dir parcel count (0..2,
;; including zero - the "empty batch directory" shape this ticket exists
;; for) independently, with noise files/dirs a coin flip on top, so every
;; row scenario 01 names is demonstrably drawn, not merely hoped for.

(ns bl1611-drift-guard-in-process-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def failures (atom []))
(defn- assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 1611))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rbool [] (.nextBoolean rng))

(def ^:private handoff-body
  "id: p\nfrom: specifier\nto: role\nrecipient: role\npriority: 00\ntype: note\n\nbody\n")

(def branches-hit (atom #{}))

(defn- build-tree!
  "Materializes a random in_process box under dir. Returns whether it
   placed at least one .handoff file anywhere the invariant says the
   reader must see it (top level or inside a batch_ directory)."
  [dir]
  (let [top-count (rint 3)
        batch-count (rint 4)
        noise? (rbool)
        any-batch-parcel? (atom false)]
    (dotimes [i top-count]
      (spit (str (fs/path dir (format "%02d_top.handoff" i))) handoff-body))
    (when noise?
      (spit (str (fs/path dir "not-a-handoff.txt")) "noise\n")
      (fs/create-dirs (fs/path dir "not_a_batch_dir")))
    (dotimes [b batch-count]
      (let [bdir (fs/path dir (format "batch_20260917T%06dZ_%06d" b b))
            parcel-count (rint 3)]
        (fs/create-dirs bdir)
        (dotimes [j parcel-count]
          (spit (str (fs/path bdir (format "%02d_p.handoff" j))) handoff-body))
        (when (pos? parcel-count) (reset! any-batch-parcel? true))))
    (swap! branches-hit conj
           (cond
             (and (zero? top-count) (zero? batch-count)) :nothing-at-all
             (pos? top-count) :top-level-parcel
             (and (pos? batch-count) @any-batch-parcel?) :batch-with-parcel
             (and (pos? batch-count) (not @any-batch-parcel?)) :batch-all-empty
             :else :other))
    (or (pos? top-count) @any-batch-parcel?)))

(dotimes [_ 150]
  (let [dir (str (fs/create-temp-dir {:prefix "bl1611-prop-"}))]
    (try
      (let [expected (build-tree! dir)
            visible (handoff-lib/handoff-files-with-batches dir)
            actual (boolean (seq visible))]
        (assert-true (str "existence matches generated truth (dir=" dir " expected=" expected " actual=" actual ")")
                     (= expected actual)))
      (finally
        (fs/delete-tree dir)))))

(assert-true (str "the generator reached every roster-shape row this ticket names: nothing at all, "
                   "a top-level parcel, a batch directory with a parcel, and a batch directory that "
                   "stays empty")
             (and (contains? @branches-hit :nothing-at-all)
                  (contains? @branches-hit :top-level-parcel)
                  (contains? @branches-hit :batch-with-parcel)
                  (contains? @branches-hit :batch-all-empty)))

;; ── non-vacuousness ───────────────────────────────────────────────────────
;; The exact class of bug this invariant exists to prevent: a reader that
;; never descends into batch_ directories reads a batch-only parcel as
;; nothing held, silently reproducing BL-1611's own incident.
(defn- broken-flat-reader [dir]
  (if (fs/exists? dir)
    (->> (fs/list-dir dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff"))))
    []))

(let [dir (str (fs/create-temp-dir {:prefix "bl1611-prop-vac-"}))]
  (try
    (let [bdir (fs/path dir "batch_20260917T000001Z_000001")]
      (fs/create-dirs bdir)
      (spit (str (fs/path bdir "00_p.handoff")) handoff-body))
    (assert-true "non-vacuousness: the OLD flat reader wrongly reports nothing held for a batch-only parcel"
                 (empty? (broken-flat-reader dir)))
    (assert-true "non-vacuousness: the REAL batch-aware reader correctly reports it held"
                 (seq (handoff-lib/handoff-files-with-batches dir)))
    (finally
      (fs/delete-tree dir))))

(if (seq @failures)
  (do
    (binding [*out* *err*]
      (doseq [f @failures] (println f)))
    (println (str "\n" (count @failures) " property failure(s)"))
    (System/exit 1))
  (println "ALL PROPERTIES HOLD: handoff-files-with-batches in-process existence (BL-1611, 150 runs)"))
