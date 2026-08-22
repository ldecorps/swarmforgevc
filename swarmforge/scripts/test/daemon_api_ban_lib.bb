#!/usr/bin/env bb
;; daemon_api_ban_lib.bb — BL-1022: the subprocess-API ban's scan, shared by the
;; gate (daemon_cycle_guard_lib_test_runner.bb) and the acceptance step handlers
;; (specs/pipeline/steps/bl1022DaemonClosureFollowsSpawnEdgesSteps.js).
;;
;; It lives under scripts/test/ rather than beside the walk in
;; master_checkout_drift_lib.bb ON PURPOSE. That lib is loaded BY the daemon, so
;; anything added to it joins the very closure this ban is computed over. A scan
;; that exists only to check the daemon has no business inside it.
;;
;; Extracted rather than copied because the acceptance feature's scenario 02
;; must exercise the REAL scan - a step handler with its own private copy would
;; pass while the gate did something else, which is the failure mode this whole
;; ticket is about.

(ns daemon-api-ban-lib
  (:require [clojure.string :as str]))

(def forbidden-re
  "babashka.process and clojure.java.shell are banned outside the bounded
   chokepoint. Banning the two NAMESPACE tokens is complete for those
   namespaces: an aliased call cannot exist without naming the namespace in its
   require. process/sh and process/process catch the call sites themselves."
  #"babashka\.process|clojure\.java\.shell|process/sh|process/process")

(defn strip-comments-and-strings
  "Blanks ;-comments and the CONTENTS of double-quoted strings (keeping their
   newlines, so line numbers survive multi-line docstrings). A backslash outside
   a string starts a char literal - its next char is skipped, so the \\\" char
   literal never opens a phantom string.

   Prose must never trip a gate that exists to catch calls: handoff_lib.bb's
   docstrings NAME clojure.java.shell while forbidding it."
  [content]
  (let [sb (StringBuilder.)]
    (loop [chars (seq content) in-string? false escaped? false]
      (if-let [c (first chars)]
        (cond
          in-string?
          (cond
            escaped? (recur (rest chars) true false)
            (= c \\) (recur (rest chars) true true)
            (= c \") (do (.append sb c) (recur (rest chars) false false))
            (= c \newline) (do (.append sb c) (recur (rest chars) true false))
            :else (recur (rest chars) true false))
          (= c \\) (recur (rest (rest chars)) false false)
          (= c \") (do (.append sb c) (recur (rest chars) true false))
          (= c \;) (recur (drop-while #(not= % \newline) chars) false false)
          :else (do (.append sb c) (recur (rest chars) false false)))
        (str sb)))))

(defn offenders
  "Every banned-API reference in `files`, as `\"<file>:<line>: <source>\"`.
   `read-file` is (fn [name] -> content-or-nil), injected so this is drivable
   from an in-memory map. `exempt` names the chokepoint itself, which is the one
   place the API is allowed."
  ([files read-file] (offenders files read-file #{"daemon_cycle_guard_lib.bb"}))
  ([files read-file exempt]
   (vec (for [f (sort files)
              :when (not (contains? exempt f))
              :let [content (if (map? read-file) (get read-file f) (read-file f))]
              :when content
              [i line] (map-indexed vector (str/split-lines (strip-comments-and-strings content)))
              :when (re-find forbidden-re line)]
          (str f ":" (inc i) ": " (str/trim line))))))
