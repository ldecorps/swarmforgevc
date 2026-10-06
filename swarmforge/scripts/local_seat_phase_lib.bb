;; BL-2037: pure transitions over a local-model seat's per-parcel phase
;; record. A local model's context window is too small to read a ticket,
;; change it and check it in one session, so a parcel on a local-model seat
;; runs as three phases (arrange gathers, act changes, assert checks), each
;; in a fresh session. What one phase learns reaches the next only through
;; this record: the current phase, the count of failed asserts, and every
;; phase's notes, appended in order. This file is pure (parse/render/move);
;; the CLI (local_seat_phase_cli.bb) owns all file IO.
;;
;; Invariant 1: a record moves only arrange to arrange, act or assert; act
;; to assert; assert to act on a failed assert while fewer than 2 have
;; failed; or assert to done on a passed assert. Any other move is refused
;; (:ok false) and the caller must leave the record completely unchanged -
;; no note appended either (a refusal is not an attempt).
;; Invariant 2: notes are only ever appended, in order. Every function below
;; that returns :ok true hands back a record with its phase/failed already
;; updated but WITHOUT the note appended - the caller (CLI) appends the
;; note itself, uniformly, for every :ok true result (including the
;; split-request case, which moves nothing but still records that the
;; phase wrote a note).

(ns local-seat-phase-lib
  (:require [clojure.string :as str]))

(def valid-phases #{"arrange" "act" "assert" "done"})

(def initial-record {:phase "arrange" :failed 0 :notes []})

(def note-separator "===")

(def max-failed 2)

;; ── serialization ────────────────────────────────────────────────────────

(defn render
  "The record's on-disk text. Round-trips through parse."
  [{:keys [phase failed notes]}]
  (str "phase: " phase "\n"
       "failed: " failed "\n"
       (apply str (for [n notes] (str note-separator "\n" n "\n")))))

(defn- parse-int [s default]
  (try (Long/parseLong (str/trim (str s))) (catch Exception _ default)))

(defn parse
  "Reads render's own text back into a record. Blank/nil text (no record
   file yet) parses as initial-record. A malformed phase value falls back
   to \"arrange\" rather than crash the CLI on a hand-edited file."
  [text]
  (if (str/blank? text)
    initial-record
    (let [lines (str/split (str text) #"\n")
          phase-line (first (filter #(str/starts-with? % "phase:") lines))
          failed-line (first (filter #(str/starts-with? % "failed:") lines))
          phase (if phase-line (str/trim (subs phase-line (count "phase:"))) "arrange")
          failed (if failed-line (parse-int (subs failed-line (count "failed:")) 0) 0)
          rest-text (str/join "\n" (drop 2 lines))
          chunks (str/split rest-text (re-pattern (str "(?m)^" note-separator "$")))
          notes (->> chunks (map str/trim) (remove str/blank?) vec)]
      {:phase (if (valid-phases phase) phase "arrange") :failed (max 0 failed) :notes notes})))

(defn append-note
  [record note]
  (update record :notes (fn [notes] (conj (vec notes) (str note)))))

;; ── moves ────────────────────────────────────────────────────────────────

(def end-targets
  "Legal `end --to` destinations by current phase. assert and done have no
   entry (an empty set) - end never moves out of either; fail/pass do."
  {"arrange" #{"arrange" "act" "assert"}
   "act" #{"assert"}})

(defn end-move
  "A parcel's own phase finished gathering (arrange) or changing (act) and
   names where it goes next. Refuses (:ok false) every move not in
   end-targets, including any move out of assert or done - those move only
   through fail-move/pass-move."
  [record to]
  (let [from (:phase record)]
    (if (contains? (get end-targets from #{}) to)
      {:ok true :record (assoc record :phase to)}
      {:ok false :reason (str "cannot end phase \"" from "\" to \"" to "\"")})))

(defn fail-move
  "An assert phase found a defect. Fewer than max-failed failures so far:
   returns to act, counting the failure. At max-failed already: moves
   nothing (stays in assert, failed stays at max-failed) and reports
   :split true - the caller still appends the note and prints the split
   request; this is not a refusal, it is the designed outcome of a second
   consecutive failed assert."
  [record]
  (let [from (:phase record)]
    (cond
      (not= from "assert")
      {:ok false :reason (str "cannot fail from phase \"" from "\"")}

      (>= (:failed record) max-failed)
      {:ok true :split true :record record}

      :else
      {:ok true :split false :record (-> record (assoc :phase "act") (update :failed inc))})))

(defn pass-move
  "An assert phase found nothing wrong: the parcel is done."
  [record]
  (if (= (:phase record) "assert")
    {:ok true :record (assoc record :phase "done")}
    {:ok false :reason (str "cannot pass from phase \"" (:phase record) "\"")}))
