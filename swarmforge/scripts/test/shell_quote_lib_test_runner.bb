#!/usr/bin/env bb
;; BL-1029: TDD runner for shell_quote_lib.bb - the ONE place a launch path is
;; quoted for a shell.
;;
;; Every assertion that matters here runs the constructed argument through a
;; REAL shell and compares what comes back to what went in. A substring or
;; text match would pass whether the escaping is correct or broken - which is
;; exactly how the defect survived BL-1018's own property runner (the accepted
;; hardener rule of 2026-08-22 records why), and why this ticket asks for the
;; round trip instead.

(ns shell-quote-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "shell_quote_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg expr] (when-not expr (swap! failures conj (str "FAIL: " msg))))

;; Evaluates `argument` the way tmux does - handing the whole string to a
;; shell - and reports what the shell actually saw as the single word.
;; `printf %s` rather than `echo` so nothing in the path is interpreted.
(defn round-trip [argument]
  (let [{:keys [out exit]} (process/sh {:out :string :err :string :continue true}
                                       "sh" "-c" (str "printf '%s' " argument))]
    {:exit exit :recovered out}))

(def path-shapes
  ["/Users/plain/.swarmforge/launch/coder.sh"
   "/Users/O'Brien/.swarmforge/launch/coder.sh"
   "/Users/two words/.swarmforge/launch/$role.sh"
   "/tmp/it's a \"quoted\" path/launch.sh"
   "/tmp/back\\slash/launch.sh"
   "/tmp/semi;colon&and|pipe/launch.sh"
   "/tmp/`backtick`/launch.sh"
   "/tmp/newline\nin path/launch.sh"])

(doseq [p path-shapes]
  (let [{:keys [exit recovered]} (round-trip (shell-quote-lib/shell-quote-single p))]
    (assert= (str "a quoted path evaluates cleanly: " (pr-str p)) 0 exit)
    (assert= (str "a quoted path round-trips byte-for-byte: " (pr-str p)) p recovered)))

;; The command builder is what the call sites use, so it is what has to be
;; right - not just the quoting primitive underneath it.
(doseq [p path-shapes]
  (let [command (shell-quote-lib/launch-command p)
        {:keys [exit recovered]} (round-trip (str/replace-first command #"^zsh " ""))]
    (assert-true (str "the launch command runs zsh: " (pr-str p)) (str/starts-with? command "zsh "))
    (assert= (str "the launch command's path argument round-trips: " (pr-str p)) 0 exit)
    (assert= (str "the launch command names exactly the path it was given: " (pr-str p)) p recovered)))

;; The pre-fix construction, kept as a NEGATIVE control: a test that has never
;; seen the broken shape fail is a coverage counter.
(let [broken (str "'" "/Users/O'Brien/x.sh" "'")
      {:keys [exit]} (round-trip broken)]
  (assert-true "the pre-fix bare-single-quote construction really does fail in a shell"
               (not= 0 exit)))

(assert= "an empty path is still a well-formed empty argument" "''" (shell-quote-lib/shell-quote-single ""))
(assert= "nil is quoted as the empty string rather than the literal nil" "''" (shell-quote-lib/shell-quote-single nil))

(if (empty? @failures)
  (println "shell_quote_lib (BL-1029): ALL TESTS PASSED")
  (do (println (str "shell_quote_lib (BL-1029): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
