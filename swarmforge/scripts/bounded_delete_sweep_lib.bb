#!/usr/bin/env bb
;; BL-460: the shared bounded-DELETE windowing both /tmp sweeps (BL-413's
;; stale-sandbox dir sweep, BL-458's orphan-process fixture reaper) now use.
;;
;; ROOT CAUSE this fixes: both sweeps previously did
;; `(doseq [name (take cap (list-entries root))] ...)` every tick - a
;; bounded SCAN, always starting at the SAME fixed position (the front of
;; raw readdir order). When the first `cap` entries never contained a
;; reapable one (live: /tmp's first 100 held 0 of 5 fresh matches, 95
;; non-matching), the sweep re-scanned the identical dead window FOREVER and
;; never made progress - 76 orphan processes untouched at 21h, /tmp GROWING
;; +21/min, zero log lines. The fix is a bounded DELETE window instead: a
;; persisted CURSOR (the last name examined) that advances every tick and
;; WRAPS at the end of a stable SORTED listing, so repeated ticks sweep the
;; entire directory over ceil(count/cap) ticks regardless of how many
;; leading entries are never removable.
;;
;; Pure windowing only - no I/O beyond the small state-file helpers below,
;; which each caller's own wiring points at its own redirectable env seam
;; (never the real /tmp path by default in a test).

(ns bounded-delete-sweep-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; Pure: given the CURRENT listing of entry names (any order - sorted here
;; so the window is deterministic and independent of raw readdir order,
;; which is not a stable contract), the cursor the PRIOR tick left behind
;; (the last name it examined, or nil on the very first tick), and the
;; per-tick cap, returns {:window [...] :next-cursor <name-or-cursor>}.
;;
;; The window starts at the first sorted name STRICTLY GREATER than the
;; cursor and wraps to the front once none remain - using ORDERING rather
;; than exact identity means a cursor whose own entry has since been
;; removed (the common case - it was reapable) still resumes from
;; approximately the right place, never restarting from the very beginning.
;; A cap at or above the total entry count returns the WHOLE listing in one
;; window (never re-examines an entry twice within the same tick).
(defn next-window
  [names cursor cap]
  (let [sorted (vec (sort names))
        total (count sorted)]
    (if (zero? total)
      {:window [] :next-cursor cursor}
      (let [cap (min cap total)
            start-idx (if cursor
                        (or (first (keep-indexed (fn [i v] (when (pos? (compare v cursor)) i)) sorted))
                            0)
                        0)
            window (vec (take cap (drop start-idx (cycle sorted))))]
        {:window window :next-cursor (last window)}))))

;; Shared "write -> atomic rename" posture operator_runtime.bb's own
;; atomic-spit! already uses for every other piece of cross-tick state,
;; applied here so a crash mid-write never leaves a corrupt cursor/count
;; that could mis-resume the window.
(defn- atomic-write-string! [path s]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) s)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

;; A small, redirectable, atomically-written cursor file. Absent/unreadable/
;; empty all resolve to nil (start-of-listing), never a crash.
(defn read-cursor [path]
  (try
    (when (fs/exists? path)
      (let [s (str/trim (slurp (str path)))]
        (when (seq s) s)))
    (catch Exception _ nil)))

(defn write-cursor! [path cursor]
  (atomic-write-string! path (or cursor "")))

;; The sibling counter used for the "periodic, not per-tick" nothing-found
;; log line - same atomic-write posture, same "unreadable -> 0" safe default.
(defn read-count [path]
  (try (if (fs/exists? path) (or (parse-long (str/trim (slurp (str path)))) 0) 0) (catch Exception _ 0)))

(defn write-count! [path n]
  (atomic-write-string! path (str n)))

;; The "persist cursor, then report reaped vs periodic nothing-found"
;; bookkeeping both sweep callers need after computing their tick's window -
;; centralized so a change to the periodic-log cadence or wording has one
;; call site, not one per sweep. log! takes a single message string; a
;; caller whose own log! needs a category tag (e.g. operator_runtime.bb's
;; two-arg log!) passes a one-arg wrapper.
(defn record-tick! [{:keys [cursor-file next-cursor nothing-streak-file
                             nothing-log-period reaped window log!]}]
  (write-cursor! cursor-file next-cursor)
  (if (pos? reaped)
    (do (log! (str "reaped " reaped " of " (count window) " scanned"))
        (write-count! nothing-streak-file 0))
    (let [streak (inc (read-count nothing-streak-file))]
      (write-count! nothing-streak-file streak)
      (when (or (= streak 1) (zero? (mod streak nothing-log-period)))
        (log! (str "scanned " (count window) ", nothing reaped (streak " streak ")"))))))
