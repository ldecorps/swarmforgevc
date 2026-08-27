#!/usr/bin/env bb
;; BL-998 coder pass (BL-654 Invariants): a PROPERTY over the isolation
;; guard, encoding the ticket's declared invariant 2:
;;
;;   "The guard decides membership by inspecting what each test executes,
;;    never from a checked-in roster of file names, so a newly added
;;    offender is caught without anyone remembering to edit a list."
;;
;; The acceptance covers three hand-written shapes. This quantifies the same
;; claim over the axes a regex-based inspector actually breaks on: the
;; VARIABLE NAME the test binds, WHICH helper it runs, whether the helper is
;; executed or merely read, and whether the path is anchored at the real
;; scripts dir or at a fixture copy. The file NAME is randomised every run
;; too - a guard carrying a roster would pass for names on the list and fail
;; for the rest, and this cannot be satisfied by any list.
;;
;; Expected verdict is computed from the SHAPE, never from the guard:
;;   flagged  <=>  executes a self-rooting helper via a real-scripts-dir path.
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none),
;; and the same Babashka-property-tooling-gap note (BL-472).
;;
;; Non-vacuity proven at authoring time, two ways:
;;   - replacing the guard's derived self-rooting scan with a hardcoded list
;;     of today's offender FILENAMES fails this immediately - every generated
;;     file carries a fresh random name, so a roster matches none of them and
;;     every offending case goes unflagged;
;;   - removing the guard's closure over sibling process invocations (step
;;     1b) fails every :transitive case, which is the shape that bounced this
;;     ticket back to the coder in the first place.

(ns bl998-guard-membership-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def here (fs/parent (fs/canonicalize *file*)))
(def real-scripts (fs/parent here))
(def guard-name "test_shell_fixture_dispatch_isolation.sh")

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 96))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

;; SELF-ROOTING helpers resolve their own root; LEAF helpers take the root
;; they are given. All three lists name real files, copied out of the real
;; tree below, so this stays honest if the helpers change.
;;
;; The self-rooting set has TWO shapes and the property must reach both:
;;
;;   :direct     - the script itself runs the dispatch table, asks git for
;;                 the root, or cd's to $0's own directory.
;;   :transitive - nothing in the script resolves a root, and it escapes the
;;                 fixture anyway because it STARTS a sibling resolved from
;;                 its own on-disk directory that is itself self-rooting.
;;                 done_with_current_task.bb is the case that bounced this
;;                 ticket: an inspector that stops after one hop calls it a
;;                 leaf - the ticket's own constraints did - and it still
;;                 lands in the real checkout via
;;                 (process/exec (fs/path script-dir "ready_for_next_task.sh")).
;;                 done_with_current_batch.bb is the same shape one file over.
;;
;; The transitive cases only derive as self-rooting if their hop TARGET is
;; in the sandbox too, so ready_for_next_task.sh / ready_for_next_batch.sh
;; are in the direct list and must stay there.
(def self-rooting-direct
  ["ready_for_next.bb" "done_with_current.bb"
   "ready_for_next_task.sh" "ready_for_next_batch.sh"])
(def self-rooting-transitive ["done_with_current_task.bb" "done_with_current_batch.bb"])
(def leaf ["ready_for_next_task.bb"])
(def self-rooting (concat self-rooting-direct self-rooting-transitive))

;; ONE synthetic tree, reused, holding ONLY the helpers these cases name.
;; The guard re-derives the self-rooting set from the scripts dir on every
;; run, so copying all ~300 real scripts in would be ~300 greps per
;; iteration and far too slow to sample usefully. The REAL files are still
;; used - the derivation is exercised for real, just over the relevant few.
(def sandbox (str (fs/create-temp-dir {:prefix "bl998-prop-"})))
(def sb-scripts (str (fs/path sandbox "scripts")))
(fs/create-dirs (fs/path sb-scripts "test"))
(doseq [n (concat self-rooting leaf)]
  (fs/copy (fs/path real-scripts n) (fs/path sb-scripts n) {:replace-existing true}))
(fs/copy (fs/path here guard-name) (fs/path sb-scripts "test" guard-name) {:replace-existing true})

(defn- gen-case [s i]
  (let [[helper-kind s1] (gen-pick s [:direct :transitive :leaf])
        [helper s2] (gen-pick s1 (case helper-kind
                                   :direct     self-rooting-direct
                                   :transitive self-rooting-transitive
                                   :leaf       leaf))
        [anchor s3] (gen-pick s2 [:real-dir :fixture-copy])
        [executed? s4] (gen-pick s3 [true false])
        [name-idx s5] (gen-int s4 100000)
        var (str "H" name-idx "_VAR")
        file-name (str "test_bl998_gen_" i "_" name-idx ".sh")]
    [{:helper helper :helper-kind helper-kind :anchor anchor :executed? executed?
      :var var :file-name file-name
      ;; The claim: only an EXECUTED, SELF-ROOTING helper reached through the
      ;; REAL scripts dir is an offence - and self-rooting is transitive, so
      ;; the one-hop-away shape is an offence on exactly the same terms.
      ;; Anything else must be left alone.
      :expect-flagged (and executed? (not= helper-kind :leaf) (= anchor :real-dir))}
     s5]))

(defn- test-source [{:keys [helper anchor executed? var]}]
  (let [binding (if (= anchor :real-dir)
                  (str var "=\"$SCRIPT_DIR/../" helper "\"")
                  (str var "=\"$WT/swarmforge/scripts/" helper "\""))
        use (if executed?
              (str "(cd \"$WT\" && SWARMFORGE_ROLE=coder bb \"$" var "\")")
              ;; Merely READ, never run - must never be an offence.
              (str "grep -q something \"$" var "\" || true"))]
    (str/join "\n"
              ["#!/usr/bin/env bash" "set -euo pipefail"
               "SCRIPT_DIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\""
               "WT=\"$(mktemp -d)\"" binding use ""])))

(defn- guard-flags? [c]
  (let [f (fs/path sb-scripts "test" (:file-name c))]
    (spit (str f) (test-source c))
    (try
      (let [{:keys [exit out err]} (process/sh {:dir sandbox} "bash" (str (fs/path sb-scripts "test" guard-name)))]
        {:flagged (not= 0 exit) :named (str/includes? (str out err) (:file-name c))})
      (finally (fs/delete-if-exists f)))))

(def seen (atom {}))

(loop [i 0 s 13]
  (when (< i runs)
    (let [[c s'] (gen-case s i)
          k [(:helper-kind c) (:anchor c) (:executed? c)]]
      (swap! seen update k (fnil inc 0))
      (let [{:keys [flagged named]} (guard-flags? c)]
        (when (not= flagged (:expect-flagged c))
          (swap! failures conj
                 (str "FAIL membership\n  seed:   " s "\n  case:   " (pr-str (dissoc c :var))
                      "\n  expected flagged=" (:expect-flagged c) " got=" flagged)))
        (when (and flagged (not named))
          (swap! failures conj (str "FAIL naming\n  case: " (pr-str (dissoc c :var))
                                    "\n  the guard flagged it but did not NAME the file"))))
      (recur (inc i) s'))))

;; Generator reach, asserted rather than hoped for: every combination of
;; (helper kind x anchor x executed?) must have been generated, or the
;; property silently tested less than it claims.
(doseq [hk [:direct :transitive :leaf] a [:real-dir :fixture-copy] e [true false]]
  (when-not (get @seen [hk a e])
    (swap! failures conj (str "FAIL generator-reach: never generated " (pr-str [hk a e])))))

(fs/delete-tree sandbox)

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str "\n" (count @failures) " property check(s) failed"))
      (System/exit 1))
  (println (str "ALL PASS: bl998_guard_membership_property_runner.bb (" runs " runs)")))
