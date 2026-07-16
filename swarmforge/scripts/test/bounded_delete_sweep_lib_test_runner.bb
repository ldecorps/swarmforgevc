#!/usr/bin/env bb
;; TDD runner for bounded_delete_sweep_lib.bb (BL-460) - pure assertions
;; against injected listings/cursors, no real /tmp, no real process table.
(ns bounded-delete-sweep-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "bounded_delete_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── next-window: the core bounded-scan-wedge fix ───────────────────────────

(assert= "next-window: empty listing returns an empty window, cursor unchanged"
         {:window [] :next-cursor "stale-cursor"}
         (bounded-delete-sweep-lib/next-window [] "stale-cursor" 10))

(assert= "next-window: nil cursor starts at the front of the SORTED listing"
         {:window ["a" "b" "c"] :next-cursor "c"}
         (bounded-delete-sweep-lib/next-window ["c" "a" "b"] nil 3))

(assert= "next-window: cap smaller than the listing returns only the first `cap` sorted names"
         {:window ["a" "b"] :next-cursor "b"}
         (bounded-delete-sweep-lib/next-window ["c" "a" "b" "d"] nil 2))

;; BL-460 tmp-sweep-bounded-deletes-01/02: the exact wedge scenario - a
;; listing whose first N (> cap) entries are ALL "non-reapable" from the
;; window's own perspective (they never advance the cursor forward if the
;; OLD fixed-position bug were still present) - proving the window itself
;; makes progress past a fixed cap boundary tick over tick.
(let [names (vec (map #(format "n%03d" %) (range 0 250))) ;; n000..n249, sorted already
      tick1 (bounded-delete-sweep-lib/next-window names nil 100)
      tick2 (bounded-delete-sweep-lib/next-window names (:next-cursor tick1) 100)
      tick3 (bounded-delete-sweep-lib/next-window names (:next-cursor tick2) 100)]
  (assert= "next-window tick 1: covers n000..n099" (subvec names 0 100) (:window tick1))
  (assert= "next-window tick 2: covers n100..n199 - the SECOND window of the cap, never re-covering tick 1's"
           (subvec names 100 200) (:window tick2))
  (assert= "next-window tick 3: covers the remaining n200..n249 THEN wraps to n000..n049"
           (vec (concat (subvec names 200 250) (subvec names 0 50)))
           (:window tick3)))

(assert= "next-window: a cursor whose OWN entry has since been removed still resumes from the next-greater name, not the beginning"
         {:window ["c" "d"] :next-cursor "d"}
         (bounded-delete-sweep-lib/next-window ["a" "c" "d"] "b" 2))

(assert= "next-window: a cursor at (or past) the last sorted name wraps to the front"
         {:window ["a" "b"] :next-cursor "b"}
         (bounded-delete-sweep-lib/next-window ["a" "b" "c"] "c" 2))

(assert= "next-window: cap >= total returns the WHOLE listing once, never a repeated entry"
         {:window ["a" "b" "c"] :next-cursor "c"}
         (bounded-delete-sweep-lib/next-window ["c" "b" "a"] nil 100))

;; ── read-cursor / write-cursor! (real, isolated tmp files) ─────────────────

(let [dir (str (fs/create-temp-dir))
      path (str (fs/path dir "cursor"))]
  (assert= "read-cursor: a missing file resolves to nil, never a crash" nil (bounded-delete-sweep-lib/read-cursor path))
  (bounded-delete-sweep-lib/write-cursor! path "sfvc-abc")
  (assert= "write-cursor!/read-cursor: round-trips the written name" "sfvc-abc" (bounded-delete-sweep-lib/read-cursor path))
  (bounded-delete-sweep-lib/write-cursor! path nil)
  (assert= "write-cursor!: writing nil clears the cursor back to nil on the next read" nil (bounded-delete-sweep-lib/read-cursor path)))

;; ── read-count / write-count! ───────────────────────────────────────────────

(let [dir (str (fs/create-temp-dir))
      path (str (fs/path dir "streak"))]
  (assert= "read-count: a missing file resolves to 0, never a crash" 0 (bounded-delete-sweep-lib/read-count path))
  (bounded-delete-sweep-lib/write-count! path 7)
  (assert= "write-count!/read-count: round-trips the written value" 7 (bounded-delete-sweep-lib/read-count path)))

;; ── report ─────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: bounded_delete_sweep_lib.bb"))
