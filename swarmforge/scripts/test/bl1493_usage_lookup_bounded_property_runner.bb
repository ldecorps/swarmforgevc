#!/usr/bin/env bb
;; BL-1493: PROPERTY tests over context_telemetry_store.bb's
;; latest-event-for-role, covering the ticket YAML's one declared
;; invariant (coder-authored first, per BL-654):
;;
;;   "The cost of the delivery hop's usage lookup is bounded by the
;;    distance from the file's tail to the role's latest row (or to the
;;    window's edge), never by the file's length; within the window its
;;    answer is identical to a full read's, and a role with no row in the
;;    window yields nil exactly as an absent log does."
;;
;; Two properties, seeded (not wall-clock) randomness so failures
;; reproduce - a fixed-seed java.util.Random, never rand/rand-int's
;; unseeded global generator. Follows the established .bb property-runner
;; precedent (bl942_hardening_debt_ledger_property_runner.bb).
;;
;;   P1 within-window-matches-full-read: over randomly generated logs
;;      (random role sequence, random event count, random field values),
;;      for a role whose LAST occurrence lies within window-bytes of the
;;      tail (window sized from that occurrence's own byte offset PLUS a
;;      margin covering at least one preceding line, so the target line
;;      itself can never be the window-edge line latest-event-for-role
;;      always drops - constructed, never hoped-for), latest-event-for-role's
;;      answer equals the reference "full read, filter by role, sort by
;;      timestamp, take last" computation - the exact behaviour
;;      read-events!-based lookup gave before this ticket.
;;
;;   P2 outside-window-or-absent-yields-nil: for a role whose only
;;      occurrence sits strictly before a window sized to land inside the
;;      gap before it (constructed from the generated log's own byte
;;      offsets, never a guessed constant), or a role that never appears
;;      in the log at all, latest-event-for-role returns nil - identical
;;      to what an absent log answers.
;;
;; Generator reach: every trial's log names at least 2 distinct roles
;; (asserted below) so P1 and P2 always have a real "some role, not the
;; latest-overall one" to test against - never degenerating to a
;; single-role log where every role IS the tail.
;;
;; Non-vacuity (checked by hand before landing, restored before commit):
;;   break 1 - the window-edge line drop removed (the `(rest lines)` guard
;;     when start > 0, so a possibly-partial boundary line is parsed):
;;     P2 fails whenever the too-small window's cut point lands inside a
;;     line whose cleaned/garbled remainder happens to still parse as
;;     valid JSON naming the target role - rare with this generator's
;;     ASCII-only ints/enums, so this break is a design note rather than
;;     one this generator reliably catches; the acceptance scenario's
;;     torn-tail case (real NUL corruption) is the reliable check for
;;     this path.
;;   break 2 - the reversed-scan short-circuit changed from "first match
;;     wins" to "last match in scan order wins" (a stray extra (reverse
;;     ...)): P1 fails immediately whenever a role has 2+ occurrences in
;;     the window, which nearly every trial's roles do.
;;   break 3 - the `(= role (:role parsed))` filter dropped so the first
;;     PARSEABLE line (any role) is returned: P1 fails whenever the
;;     target role is not literally the log's last line, which most
;;     trials arrange.
;; All three restored byte-for-byte, ALL PROPERTIES HOLD.

(ns bl1493-usage-lookup-bounded-property-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "context_telemetry_store.bb")))

(def failures (atom []))
(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 1493))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rchoice [coll] (nth coll (rint (count coll))))

(def ^:private roles ["coder" "cleaner" "architect" "hardender"])
(def ^:private models ["claude-sonnet-5" "claude-fable-5-1" "glm-5.3-flash"])
(def ^:private providers ["anthropic" "tencentcloud2"])

;; The SAME "full read, filter, sort, take last" shape
;; latest-role-usage-from-context-events used before this ticket - the
;; reference this property checks the new bounded reader against, never a
;; second copy of the new function's own logic.
(defn- reference-latest [events role]
  (->> events
       (filter #(= role (:role %)))
       (sort-by #(.toEpochMilli (java.time.Instant/parse (:timestamp %))))
       last))

(defn- gen-events [n]
  (loop [i 0 t 1700000000000 acc []]
    (if (>= i n)
      acc
      (let [role (rchoice roles)
            event {:role role
                   :timestamp (.toString (java.time.Instant/ofEpochMilli t))
                   :model (rchoice models)
                   :provider (rchoice providers)
                   :input_tokens (rint 1000)
                   :output_tokens (rint 1000)}]
        (recur (inc i) (+ t 1000 (rint 5000)) (conj acc event))))))

(defn- line-bytes [event]
  (.getBytes (str (json/generate-string event) "\n") "UTF-8"))

(defn- line-bytes-len [event] (count (line-bytes event)))

;; The exact bytes latest-event-for-role's own store writes - one JSON
;; object per line, newline-terminated, in APPEND order (the property
;; relies on append order == chronological order, the same assumption the
;; production log itself guarantees).
(defn- events->jsonl [events]
  (str/join "" (map #(String. (line-bytes %) "UTF-8") events)))

;; suffixes[i] = total bytes of events[i..end] inclusive - the exact
;; window size that JUST reaches back to the START of line i (window >=
;; suffixes[i] includes line i; window < suffixes[i] excludes it).
(defn- suffix-byte-lengths [events]
  (let [n (count events)
        lens (mapv line-bytes-len events)]
    (loop [i (dec n) acc 0 result (vec (repeat n 0))]
      (if (neg? i)
        result
        (let [new-acc (+ acc (nth lens i))]
          (recur (dec i) new-acc (assoc result i new-acc)))))))

;; {:index :suffix-len :margin} for role's LAST occurrence, where :margin
;; is the byte length of the immediately PRECEDING line (0 if role's last
;; occurrence is the very first line) - the amount a window must exceed
;; :suffix-len by by to guarantee the target line is never itself the
;; window-edge line latest-event-for-role unconditionally drops.
(defn- last-occurrence-info [events role]
  (let [suffixes (suffix-byte-lengths events)
        lens (mapv line-bytes-len events)]
    (loop [i (dec (count events))]
      (if (neg? i)
        nil
        (if (= role (:role (nth events i)))
          {:index i :suffix-len (nth suffixes i) :margin (if (pos? i) (nth lens (dec i)) 0)}
          (recur (dec i)))))))

(def tmp-root (str (fs/create-temp-dir {:prefix "bl1493-usage-lookup-"})))
(.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (try (fs/delete-tree tmp-root) (catch Exception _ nil)))))

(defn- write-log! [events]
  (let [dir (fs/path tmp-root (str "trial-" (rint 1000000000)))]
    (fs/create-dirs dir)
    (spit (str (context-telemetry-store/log-file (str dir))) (events->jsonl events))
    (str dir)))

(def runs 60)

(dotimes [trial runs]
  (let [n (+ 4 (rint 30))
        events (gen-events n)
        distinct-roles (vec (distinct (map :role events)))]
    (assert-true (str "P1/P2 trial " trial ": the generated log names at least 2 distinct roles")
                 (>= (count distinct-roles) 2))
    (when (>= (count distinct-roles) 2)
      (let [state-dir (write-log! events)
            target-role (rchoice distinct-roles)
            info (last-occurrence-info events target-role)]

        ;; ── P1: within-window-matches-full-read ──────────────────────────
        (when info
          (let [window (+ (:suffix-len info) (:margin info) 1 (rint 100))
                expected (reference-latest events target-role)
                actual (context-telemetry-store/latest-event-for-role state-dir target-role window)]
            (assert-true (str "P1 trial " trial ": within-window answer for role " target-role " matches the full-read reference")
                         (= expected actual))))

        ;; ── P2a: a window landing strictly before the role's last
        ;;    occurrence yields nil (constructed from the log's own
        ;;    offsets, whenever room exists for a smaller window) ───────
        (when (and info (> (:suffix-len info) 1))
          (let [too-small (max 1 (quot (:suffix-len info) 2))]
            (when (< too-small (:suffix-len info))
              (let [actual (context-telemetry-store/latest-event-for-role state-dir target-role too-small)]
                (assert-true (str "P2a trial " trial ": a window smaller than the distance to role " target-role "'s last row yields nil")
                             (nil? actual))))))

        ;; ── P2b: a role absent from the log yields nil regardless of
        ;;    window size ───────────────────────────────────────────────
        (let [absent-role (str "absent-role-" (rint 1000000))
              total-bytes (count (.getBytes (events->jsonl events) "UTF-8"))
              actual (context-telemetry-store/latest-event-for-role state-dir absent-role total-bytes)]
          (assert-true (str "P2b trial " trial ": a role with no row anywhere in the log yields nil")
                       (nil? actual)))))))

;; ── report ───────────────────────────────────────────────────────────────
(println (str "bl1493_usage_lookup_bounded_property_runner: " runs " trials"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 20 @failures)] (println f))
      (System/exit 1)))
