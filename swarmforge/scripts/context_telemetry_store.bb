#!/usr/bin/env bb
;; Context Telemetry's fs adapter (GH-22 Slice 1) — mirrors
;; model_steward_store.bb's shape: thin fs I/O only, no decisions (those
;; live in context_telemetry_lib.bb). Owns the append-only runtime log under
;; .swarmforge/telemetry/context-events.jsonl (gitignored, mirrors
;; .swarmforge/model-steward/'s posture — no committed seed here, this log
;; starts empty).
(ns context-telemetry-store
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def default-state-dir-rel ".swarmforge/telemetry")

;; *file* is dynamically scoped to whichever file is currently being loaded —
;; capture it HERE, at load time, into a plain def. Referencing it lazily
;; inside a defn instead reads the CALLER's *file* binding at call time
;; (mirrors model_steward_store.bb's this-file — the same script-dir
;; discovery hazard applies to every load-file'd script in this dir).
(def ^:private this-file (fs/canonicalize *file*))

(defn repo-root []
  (fs/parent (fs/parent (fs/parent this-file))))

(defn log-file [state-dir]
  (fs/path state-dir "context-events.jsonl"))

;; BL-1477: NUL bytes are never part of a JSONL record - strip wherever they
;; appear before parsing, so a record glued onto a zero-filled tail (or the
;; tail itself, pure NULs) still parses cleanly once cleaned.
(defn- strip-nul [s] (str/replace s (str (char 0)) ""))

(defn- final-line-torn?
  "True when `line` (the file's content after its last newline, or the
   whole content when there is none at all) is not a whole record - the
   same unparseable-even-after-NUL-stripping test parse-events-tolerant
   applies on read."
  [line]
  (let [cleaned (strip-nul line)]
    (if (str/blank? cleaned)
      true
      (try (json/parse-string cleaned true) false
           (catch Exception _ true)))))

(defn- ensure-clean-append-point!
  "BL-1477 invariant 3: before appending, make sure the file's own tail is
   a safe place to land the next record. Three cases: (a) content already
   ends in a newline - untouched; (b) it ends with a WHOLE record simply
   missing its trailing newline - terminate it so the next record doesn't
   glue onto that same physical line; (c) it ends with a genuinely TORN
   line (NUL bytes, or anything unparseable even after NUL-stripping) -
   DROP that line entirely rather than merely newline-terminating it.
   Case (c) is the one that matters: newline-terminating a torn line
   without dropping it would leave that garbage sitting as a permanent
   INTERIOR line the moment anything is appended after it, so the one-time
   tolerance a reader affords a torn FINAL line would become interior
   damage on every read from the very next append onward - exactly what
   this invariant forbids."
  [f]
  (when (fs/exists? f)
    (let [content (slurp (str f))]
      (when (and (seq content) (not (str/ends-with? content "\n")))
        (let [last-nl (str/last-index-of content "\n")
              tail-start (inc (or last-nl -1))
              tail (subs content tail-start)]
          (if (final-line-torn? tail)
            (spit (str f) (subs content 0 tail-start))
            (spit (str f) "\n" :append true)))))))

(defn append-event!
  "Appends one already-validated event as a single JSONL line. Callers must
   validate BEFORE calling this — this function has no validation of its
   own, so the only way the log stays free of malformed records is that the
   CLI never reaches this call on a failed validate-event."
  [state-dir event]
  (fs/create-dirs state-dir)
  (let [f (log-file state-dir)]
    (ensure-clean-append-point! f)
    (spit (str f) (str (json/generate-string event) "\n") :append true)))

(defn append-events!
  "Batch form of append-event! - one file open per call rather than one per
   event, for context_telemetry_cli.bb's record-batch verb (BL-1477: one
   subprocess per TICK, not one per event)."
  [state-dir events]
  (doseq [event events]
    (append-event! state-dir event)))

;; nil (never []) signals "the read itself failed" - an unparseable line
;; with a whole line after it (interior damage: the store is the dedupe
;; cursor, and recording against a cursor that cannot be read would
;; duplicate). A torn FINAL line only - still unparseable after NUL-
;; stripping, with nothing whole after it - is dropped and named instead,
;; the same tail-vs-interior distinction contextTelemetryProducer.ts's
;; readPersistedContextEvents draws (invariant 1: one fixture, both
;; readers, the same whole records).
(defn- parse-events-tolerant [raw]
  (let [lines (str/split-lines raw)
        numbered (->> lines
                      (map-indexed (fn [i l] [(inc i) l]))
                      ;; Blankness is checked on the RAW line - a line of
                      ;; nothing but NUL bytes has real (damaged) content
                      ;; and must surface as a torn tail, never vanish as
                      ;; if it were an ordinary gap between records.
                      (remove (fn [[_ l]] (str/blank? l))))
        parsed (mapv (fn [[line-no l]]
                       (let [cleaned (strip-nul l)]
                         ;; cheshire parses an EMPTY string as a bare `nil`
                         ;; rather than throwing - a line that was ALL NUL
                         ;; bytes (torn to nothing once cleaned) must still
                         ;; count as unparseable, never as a whole record
                         ;; whose value happens to be nil.
                         (if (str/blank? cleaned)
                           [:bad line-no]
                           (try [:ok (json/parse-string cleaned true)]
                                (catch Exception _ [:bad line-no])))))
                     numbered)
        bad-positions (keep-indexed (fn [i [tag]] (when (= tag :bad) i)) parsed)]
    (cond
      (empty? bad-positions)
      {:events (mapv second parsed) :torn-tail-line nil}

      (and (= 1 (count bad-positions)) (= (first bad-positions) (dec (count parsed))))
      {:events (mapv second (butlast parsed))
       :torn-tail-line (first (nth numbered (first bad-positions)))}

      :else
      (throw (ex-info (str "context-events store: unparseable line "
                           (first (nth numbered (first bad-positions))))
                       {:line (first (nth numbered (first bad-positions)))})))))

(defn read-events!
  "Every recorded event, parsed with keyword keys, in file (append) order,
   tolerant of a torn final line (BL-1477) - dropped, never surfaced here.
   Returns an empty coll when the log does not exist yet — a fresh state
   dir with nothing recorded is not an error. Throws on interior damage
   (see parse-events-tolerant above). read-events-report! below is the same
   read PLUS the torn-tail line number, for a caller (the CLI) that needs
   to report it; this function stays a plain vector for llm_cost_ledger_
   lib.bb's own caller, which has no use for that report."
  [state-dir]
  (let [f (log-file state-dir)]
    (if (fs/exists? f)
      (:events (parse-events-tolerant (slurp (str f))))
      [])))

(defn read-events-report!
  "Same read as read-events! but also names which line, if any, was a
   dropped torn tail - {:events [...] :torn-tail-line N-or-nil}."
  [state-dir]
  (let [f (log-file state-dir)]
    (if (fs/exists? f)
      (parse-events-tolerant (slurp (str f)))
      {:events [] :torn-tail-line nil})))
