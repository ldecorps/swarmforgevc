#!/usr/bin/env bb
;; BL-1427: reads and evaluates every top-level form of the target file, IN
;; ORDER - exactly like a normal load - except it never EVALUATES a form
;; whose head is -main (bare, with *command-line-args*, or through apply);
;; that form is still READ (a reader error in it still refuses), just never
;; run. Every def/defn is still evaluated eagerly, so SCI's own eager
;; analysis of a defn's body (a missing symbol, a bad forward reference)
;; still fails exactly as before - only the trailing ENTRY CALL is skipped.
;;
;; A failure - a reader error, or an eval failure inside any def/defn's own
;; body - is left to propagate uncaught, so babashka's own top-level
;; exception handler prints the SAME error banner the caller
;; (check_bb_scripts_load.sh's analyse_one) already discriminates on. This
;; driver changes WHAT gets evaluated, never HOW a failure is reported.
;;
;; *file* is bound to the target's own path for the duration of the eval
;; loop - many scripts in this tree compute their own location at load time
;; via (fs/parent (fs/canonicalize *file*)), not only inside -main, and a
;; driver that left *file* unbound (or bound to itself) would silently
;; corrupt every one of those paths rather than refusing anything visibly.
;;
;; The target path travels through an ENV VAR, never a positional
;; *command-line-args* entry: *command-line-args* is a single var bound
;; once for the WHOLE bb process, so a positional arg here would leak into
;; whatever the analysed script's OWN top-level code reads from
;; *command-line-args* - post_commit_push.bb's top level (outside -main)
;; does exactly that: `(def lib-path (first *command-line-args*))` then
;; `(load-file lib-path)`. Handed this driver's own invocation path as
;; that "lib-path" (since it was the sole positional arg), it load-filed
;; ITSELF, recursively, to a StackOverflowError - a defect in this driver,
;; not in that script. An env var is invisible to *command-line-args*, so
;; the analysed script sees the SAME empty argv a plain `bb -e
;; "(load-file ...)"` probe always gave it.
;;
;; This file lives under swarmforge/scripts itself, so `--all` analyses it
;; too - by this same mechanism, since it is just another .bb file. Its own
;; real work therefore lives inside -main like every other script here:
;; the FIRST version of this driver ran its read-eval loop as bare top-level
;; code, so self-analysis (BB_LOAD_ANALYSE_TARGET=bb_load_analyse_driver.bb)
;; evaluated that top-level form for real, recursively re-entering the same
;; loop on the same file, to a StackOverflowError. Wrapping it in -main and
;; skipping -main on self-analysis is not a workaround, it is this driver
;; dogfooding the exact convention it exists to read.

(require '[clojure.string :as str])

(defn- strip-shebang
  "Drops a leading #!... line - present on ~184 of 292 scripts in this tree,
   absent on the rest (library .bb files never bb'd directly) - so the
   reader below never has to special-case it. Not Clojure syntax on either
   count: present, it must go; absent, this is a no-op."
  [text]
  (if (str/starts-with? text "#!")
    (let [nl (.indexOf text "\n")]
      (if (neg? nl) "" (subs text (inc nl))))
    text))

(defn- entry-call?
  "A top-level call to -main: bare (-main), with *command-line-args*, or
   through (apply -main *command-line-args*). The three shapes this
   ticket's own survey found (37 bare, 6 with *command-line-args*, 52 via
   apply) - never a fourth spelling invented here; the guard learns to
   read the shapes that exist, per the ticket's own out-of-scope line."
  [form]
  (and (seq? form)
       (let [head (first form)]
         (or (= head '-main)
             (and (= head 'apply) (= (second form) '-main))))))

(defn- analyse-without-running-main [target]
  (binding [*file* target]
    (with-open [rdr (clojure.lang.LineNumberingPushbackReader. (java.io.StringReader. (strip-shebang (slurp target))))]
      (loop []
        (let [form (read {:eof ::eof} rdr)]
          (when-not (identical? form ::eof)
            (when-not (entry-call? form)
              (eval form))
            (recur)))))))

(defn -main []
  (let [target (System/getenv "BB_LOAD_ANALYSE_TARGET")]
    (if-not target
      (do
        (binding [*out* *err*]
          (println "bb_load_analyse_driver: BB_LOAD_ANALYSE_TARGET not set"))
        (System/exit 2))
      (analyse-without-running-main target))))

(-main)
