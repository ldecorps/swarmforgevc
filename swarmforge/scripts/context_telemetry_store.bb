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

;; BL-1493: an 8 MB tail window CAP is about a day of events at the volume
;; that produced the ticket's own 67 MB / 258 157-row measurement - large
;; enough that a role delivered to within the last day always resolves,
;; small enough that the read cost stays bounded regardless of how large
;; the log has grown since. The actual read starts far smaller than this
;; (initial-tail-chunk-bytes below) and only grows toward the cap when a
;; role's row is not found near the tail - the cap bounds the WORST case,
;; it is never the read size for the common case of a recently-delivered
;; role.
(def default-tail-window-bytes (* 8 1024 1024))

;; The first chunk size a lookup tries, before doubling. Small enough that
;; a role whose latest row is within the last few hundred events - the
;; common delivery-hop case - resolves in a single read far under 1% of a
;; multi-megabyte log, per this ticket's own scenario 01 (fewer than 5%
;; of a 200 000-row log's bytes for a row 50 from the end).
(def initial-tail-chunk-bytes (* 64 1024))

;; BL-1493 acceptance seam: the read primitive latest-event-for-role calls
;; for each backward chunk attempt - real RandomAccessFile seek+readFully
;; in production. The acceptance CLI rebinds this to a byte-counting
;; wrapper to observe how many bytes a lookup actually pulled from disk,
;; without duplicating this function's own chunk-growth logic (mirrors
;; chase_sweep_lib.bb's *read-handoff-file* seam).
(def ^:dynamic *read-tail-chunk*
  (fn [raf start len]
    (let [buf (byte-array len)]
      (.seek raf start)
      (.readFully raf buf)
      buf)))

;; The lines of one read chunk, minus the window's own first line whenever
;; the chunk does not cover the whole file (start > 0): RandomAccessFile/
;; seek has no notion of line boundaries, so that line may begin mid-
;; record - dropped rather than parsed, the same "discard an incomplete
;; boundary, never guess at it" posture read-events!'s torn-tail handling
;; already uses, just applied to the chunk's OWN edge instead of the
;; file's end.
(defn- usable-chunk-lines [buf start]
  (let [lines (str/split (String. buf "UTF-8") #"\r?\n")]
    (if (and (pos? start) (seq lines)) (rest lines) (seq lines))))

;; Scans lines from LAST backward, skipping any NUL-torn or otherwise
;; unparseable line (BL-1477's shape - the scan continues past it toward
;; the next older line rather than stopping, so a damaged final line never
;; hides an earlier intact match), and returns the first (i.e. latest)
;; one whose :role matches. nil when none of this chunk's lines match.
(defn- scan-lines-for-role [lines role]
  (loop [remaining (reverse lines)]
    (when (seq remaining)
      (let [cleaned (strip-nul (first remaining))]
        (if (str/blank? cleaned)
          (recur (rest remaining))
          (let [parsed (try (json/parse-string cleaned true) (catch Exception _ nil))]
            (if (and parsed (= role (:role parsed)))
              parsed
              (recur (rest remaining)))))))))

(defn latest-event-for-role
  "BL-1493: the role's latest event, read from the file's TAIL in
   successively DOUBLING bounded chunks (RandomAccessFile) rather than a
   full read-events! parse of every row ever recorded - the cost is the
   distance from the tail to the role's latest row (or to max-window-
   bytes, whichever is smaller), never the file's length. A role whose
   row sits near the tail - the common delivery-hop case - resolves on
   the FIRST, smallest chunk; the window only grows (doubling, capped at
   max-window-bytes) when that attempt finds nothing, so total bytes
   read stay O(distance to the match) rather than O(the cap) for every
   lookup regardless of where the match actually sits.

   nil when the log is absent, or when role names no row within
   max-window-bytes of the tail - identical to what an absent log
   answers today (BL-1493's own FIRM behaviour constraint: outside the
   window reads exactly like no row at all, never an error)."
  ([state-dir role] (latest-event-for-role state-dir role default-tail-window-bytes))
  ([state-dir role max-window-bytes]
   (let [f (log-file state-dir)]
     (when (fs/exists? f)
       (let [file-len (fs/size f)]
         (when (pos? file-len)
           (with-open [raf (java.io.RandomAccessFile. (str f) "r")]
             (loop [chunk (min file-len initial-tail-chunk-bytes max-window-bytes)]
               (let [start (max 0 (- file-len chunk))
                     read-len (- file-len start)
                     buf (*read-tail-chunk* raf start read-len)
                     found (scan-lines-for-role (usable-chunk-lines buf start) role)]
                 (cond
                   found found
                   (or (zero? start) (>= chunk max-window-bytes)) nil
                   :else (recur (min max-window-bytes (* chunk 2)))))))))))))
