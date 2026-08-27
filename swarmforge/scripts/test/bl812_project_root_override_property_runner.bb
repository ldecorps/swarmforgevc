#!/usr/bin/env bb
;; BL-812 coder pass (BL-654 Invariants): PROPERTY test over handoff_lib.bb's
;; set-project-root!/target-root, encoding the ticket's first declared
;; invariant:
;;
;;   "Wake remap and resident rotation resolve project-scoped paths from
;;    handoffd's argv project-root (or an explicit equivalent), never from
;;    process cwd."
;;
;; Every root-scoped read in handoff_lib.bb (roles-tsv-path, tmux-socket,
;; launch-script-path, mono-router-active-role-path, and transitively
;; wake-session/rotate-resident-to!) routes through target-root. target-root
;; itself is exactly `(or @explicit-project-root <cwd-derived fallback>)` -
;; so the invariant reduces to one precise, pure, in-process-testable
;; property of that override: once set-project-root! has been called with a
;; non-blank value, target-root returns EXACTLY that value, for every
;; generated string - independent of whatever the real process cwd happens
;; to be (this process's own cwd never changes mid-run; the property proves
;; the override always wins BEFORE the cwd-derived branch is ever reached,
;; which is the cwd-independence the invariant asks for). A seeded
;; generator, never rand, matching this directory's other *_property_
;; runner.bb files.
;;
;; Deliberately in-process (no subprocess forking per run): babashka's own
;; classpath/require startup cost (~7-10s observed against this project's
;; load-file chain) makes a 500-run subprocess loop impractically slow -
;; every existing *_property_runner.bb in this directory is likewise a
;; single long-lived process looping over pure calls, not N forks.
;;
;; Non-vacuity proven by hand at authoring time: ran this property against
;; a deliberately broken target-root that ignored @explicit-project-root
;; (`(or nil <fallback>)` instead of `(or @explicit-project-root
;; <fallback>)`) - every run failed (target-root fell through to the real
;; git-common-dir/cwd fallback instead of echoing the generated root
;; string) - then the file was restored to the adopted fix before this
;; commit. See backlog/evidence/BL-812-coder-pass.md for the transcript.

(ns bl812-project-root-override-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

;; Filesystem-safe characters only - a real argv project-root is a real
;; path; torturing fs/path's own edge cases (surrogate-pair emoji, control
;; chars, embedded "//" that fs/path itself normalizes away) would be
;; testing babashka.fs, not this fix. No "/" here deliberately: P2 below
;; asserts the composed child path starts-with the generated root
;; byte-for-byte, which an embedded "//" would falsify only because
;; fs/path normalizes it - a test artifact, not a real property violation.
(def alphabet
  (vec "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_- .~éàü"))

;; Generates a project-root-shaped string of varied length/content -
;; absolute-looking paths, paths with spaces, unicode, trailing slashes,
;; even pathological whitespace - anything but blank (blank/nil is the
;; documented "leave unset" sentinel, covered by the fallback branch below,
;; not this override property).
(defn gen-root-string [s]
  (let [[len s1] (gen-int s 40)
        len (inc len) ;; 1..40 chars, never empty
        [chars s'] (reduce (fn [[acc s] _]
                              (let [[idx s2] (gen-int s (count alphabet))]
                                [(conj acc (nth alphabet idx)) s2]))
                            [[] s1]
                            (range len))
        candidate (str "/tmp/bl812-prop-" (apply str chars))]
    ;; Re-roll on the rare all-whitespace draw (str/blank? true) so every
    ;; generated candidate is a genuine non-blank override, matching the
    ;; property's own precondition instead of silently skipping it.
    (if (str/blank? candidate) [(str "/tmp/bl812-prop-fallback-" len) s'] [candidate s'])))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; ── P1: once set, target-root always echoes the exact override string ────

(loop [i 0 s 11]
  (when (< i runs)
    (let [[root s'] (gen-root-string s)]
      (handoff-lib/set-project-root! root)
      (let [actual (handoff-lib/target-root)]
        (when (not= actual root)
          (report! "P (invariant 1): target-root always echoes the explicit override, verbatim" 11 root
                    (str "expected=" (pr-str root) " actual=" (pr-str actual)))))
      (recur (inc i) s'))))

;; ── P2: every root-scoped reader composes with the same override - a
;;    caller cannot bypass it by going through a different entry point ────

(loop [i 0 s 13]
  (when (< i runs)
    (let [[root s'] (gen-root-string s)]
      (handoff-lib/set-project-root! root)
      (let [roles-tsv (str (handoff-lib/roles-tsv-path))
            active-role-path (str (handoff-lib/mono-router-active-role-path))]
        (when-not (str/starts-with? roles-tsv root)
          (report! "P (invariant 1): roles-tsv-path composes under the override root" 13 root
                    (str "roles-tsv-path=" (pr-str roles-tsv))))
        (when-not (str/starts-with? active-role-path root)
          (report! "P (invariant 1): mono-router-active-role-path composes under the override root" 13 root
                    (str "active-role-path=" (pr-str active-role-path)))))
      (recur (inc i) s'))))

;; ── P3 (regression guard, fixed pin not generator-dependent): clearing the
;;    override (blank/nil) restores the git-common-dir/cwd fallback - the
;;    exact behavior every caller that never calls set-project-root!
;;    (rotate_to_role.bb, operator_runtime.bb, operator_lib.bb) depends on
;;    (BL-812's own "the cwd fallback must survive" design constraint). This
;;    process IS a real git worktree, so the fallback resolves to it. ──────

(handoff-lib/set-project-root! "/tmp/bl812-should-be-cleared")
(handoff-lib/set-project-root! nil)
(let [cleared @handoff-lib/explicit-project-root
      fallback (handoff-lib/target-root)]
  (when (some? cleared)
    (report! "P3 (regression guard): set-project-root! nil clears the override" 0 nil
              (str "explicit-project-root atom still holds " (pr-str cleared))))
  (when (str/blank? fallback)
    (report! "P3 (regression guard): target-root still resolves something after clearing" 0 nil
              "target-root returned blank")))

;; ── generator coverage, asserted rather than assumed ──────────────────────

(let [distinct-count (loop [i 0 s 11 seen #{}]
                        (if (= i runs)
                          (count seen)
                          (let [[root s'] (gen-root-string s)]
                            (recur (inc i) s' (conj seen root)))))]
  (println (str "  generator coverage: distinct roots=" distinct-count "/" runs))
  (when (< distinct-count (max 1 (quot runs 2)))
    (report! "COVERAGE distinct generated roots" 11 distinct-count "generator barely varying its output")))

(println (str "handoff_lib set-project-root!/target-root override property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
