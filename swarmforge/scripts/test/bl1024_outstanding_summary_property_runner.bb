#!/usr/bin/env bb
;; BL-1024 property test (coder-authored, declared invariant) over the pure
;; closing-summary pair in expedite_lib.bb.
;;
;;   Invariant: "An expedited run never ends reporting success while leaving
;;   backlog or index state that its own closing summary does not name."
;;
;; The invariant is a statement about a GAP: for every run state, everything
;; the run actually left must appear in the printed text. So P1 computes the
;; leavings INDEPENDENTLY of outstanding-work - straight from the generated
;; run state - and requires each one to appear in the rendered summary. It
;; does not compare the summary to the function that produced it, which would
;; only prove the formatter is self-consistent.
;;
;; The generator deliberately reaches the endings that actually bit: a run is
;; drawn with and without parks, with and without its own ticket move, dry and
;; wet, and (the 2026-08-21 case) an unhappy ending. The summary must be
;; identical across endings, so `ending` is generated and then asserted to
;; make NO difference - a property, not a scenario.
;;
;; Non-vacuity proven at authoring time (2026-08-22), each break restored,
;; counts MEASURED (seed 1024, 400 runs) - and the first measurement is the
;; reason P5 exists at all:
;;   - dropping the parked-tickets item -> P1 failed ZERO times, because the
;;     moves lines already spell every parked ticket id and the hold folder.
;;     P5 was added for exactly that gap and fails 502 on the same break;
;;   - dropping the moves item -> P1 failed 138;
;;   - making a dry run report its would-be leavings -> P2 failed 327.

(ns bl1024-outstanding-summary-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {:parked 0 :no-parks 0 :moved 0 :not-moved 0 :dry 0 :wet 0 :unhappy 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(zero? i) s']))

(def ticket-pool ["BL-586" "BL-1012" "BL-1017" "BL-621" "BL-999"])
(def endings [:ok :failed-restart :bounce-bound-exhausted :stage-timeout])

(defn- gen-run [s]
  (let [[n s1] (gen-int s (inc (count ticket-pool)))
        parked (vec (take n ticket-pool))
        [moved? s2] (gen-bool s1)
        [dry? s3] (gen-int s2 5)                ; ~1 in 5 runs is a dry run
        [e s4] (gen-int s3 (count endings))]
    [{:ticket "BL-1021" :parked parked :ticket-moved? moved?
      :dry-run? (zero? dry?) :ending (nth endings e)}
     s4]))

;; Derived from the run state, NOT from outstanding-work - this is the
;; independent account of what the run actually left behind. If these two ever
;; agree only because they share an implementation, the property proves
;; nothing, which is why this is spelled out here rather than reused.
(defn- actually-left [{:keys [ticket parked ticket-moved? dry-run?]}]
  (if dry-run?
    []
    (concat parked
            (when (seq parked) ["backlog/hold/"])
            (when ticket-moved? [ticket]))))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(loop [i 0 s 1024]
  (when (< i runs)
    (let [[r s'] (gen-run s)
          items (expedite-lib/outstanding-work r)
          text (expedite-lib/format-outstanding-summary {:items items :parked (:parked r)})]
      (swap! coverage update (if (seq (:parked r)) :parked :no-parks) inc)
      (swap! coverage update (if (:ticket-moved? r) :moved :not-moved) inc)
      (swap! coverage update (if (:dry-run? r) :dry :wet) inc)
      (when (not= :ok (:ending r)) (swap! coverage update :unhappy inc))

      ;; ── P1: the invariant. Everything left is named. ─────────────────
      (doseq [left (actually-left r)]
        (when-not (str/includes? text (str left))
          (report! "P1 (invariant: nothing left behind goes unnamed)" s r
                   (str "summary does not name " left ":\n" text))))

      ;; ── P2: honest in the other direction. A dry run changed nothing,
      ;;    so it must claim nothing - a manufactured handover is its own
      ;;    defect, and would train a reader to ignore the summary. ──────
      (when (:dry-run? r)
        (when (seq items)
          (report! "P2 (a dry run has nothing outstanding)" s r (pr-str items)))
        (doseq [t (:parked r)]
          (when (str/includes? text (str t))
            (report! "P2 (a dry run must not name what it would have parked)" s r text))))

      ;; ── P3: every outstanding subject carries an owner. A deferral
      ;;    without an owner is the drop this ticket is about. ───────────
      (doseq [{:keys [subject owner]} items]
        (when (str/blank? (str owner))
          (report! "P3 (every outstanding item names an owner)" s r (str subject " has no owner"))))

      ;; ── P5: the TWO deferrals stay two subjects with two owners. ────
      ;;    P1 alone does not catch a collapsed report: the moves lines
      ;;    already spell every parked ticket id and the hold folder, so
      ;;    deleting the parked-tickets item entirely leaves P1 green
      ;;    (measured - 0 failures). The ticket's own point is that there
      ;;    are two deferrals with two different owners, and hiding one
      ;;    inside the other's text is exactly the drop it is about.
      (when (and (not (:dry-run? r)) (seq (:parked r)))
        (let [subjects (set (map :subject items))]
          (when-not (contains? subjects "the parked tickets")
            (report! "P5 (the parked tickets are their own outstanding subject)" s r (pr-str subjects)))
          (when-not (contains? subjects "the uncommitted backlog moves")
            (report! "P5 (the staged moves are their own outstanding subject)" s r (pr-str subjects))))
        (let [owners (set (map :owner items))]
          (when-not (= 2 (count owners))
            (report! "P5 (two deferrals owe two DISTINCT owners)" s r (pr-str owners)))))

      ;; ── P4: the summary does not depend on HOW the run ended. The
      ;;    failed-restart ending is the one that stalled the pipeline. ──
      (let [other (expedite-lib/format-outstanding-summary
                   {:items (expedite-lib/outstanding-work (assoc r :ending :ok))
                    :parked (:parked r)})]
        (when (not= text other)
          (report! "P4 (the leavings do not depend on the ending)" s r
                   (str "ending " (:ending r) " changed the summary"))))

      (recur (inc i) s'))))

(doseq [[k floor] {:parked 100 :no-parks 40 :moved 100 :not-moved 100 :dry 40 :wet 200 :unhappy 200}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1024 outstanding-summary properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
